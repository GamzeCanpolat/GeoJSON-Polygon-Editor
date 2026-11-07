from datetime import UTC, timedelta
from pathlib import Path
import shutil
import time
from uuid import uuid4

from sqlalchemy import delete, exists, func, select, update

from app.db.models import Category, Dataset, Feature, Job, Project, Subcategory, Workspace, utc_now
from app.schemas.jobs import JobResponse
from app.services.errors import NotFoundError, RevisionConflictError
from app.services.projects import ProjectService


class ImportErrorResponse(ValueError):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


class ImportStopped(ValueError):
    pass


class JobService:
    def __init__(self, database, settings):
        self.database, self.settings = database, settings

    def paths(self, job_id):
        # The server-generated UUID is the only path component, never filename.
        from uuid import UUID
        identifier = str(UUID(str(job_id)))
        root = self.settings.import_directory
        return root / f"{identifier}.part", root / f"{identifier}.geojson"

    @staticmethod
    def _job(session, job_id, *, lock=False):
        if lock:
            session.execute(update(Job).where(Job.id == job_id).values(error=Job.error).execution_options(synchronize_session=False))
        job = session.get(Job, job_id, populate_existing=True)
        if job is None:
            raise NotFoundError("İş bulunamadı.")
        return job

    @staticmethod
    def view(job):
        fields = JobResponse.model_fields
        values = {name: getattr(job,name) for name in fields}
        for key in ("created_at","started_at","finished_at","activated_at"):
            if values[key] is not None:
                values[key] = values[key].replace(tzinfo=UTC)
        return JobResponse(**values)

    def get(self, job_id):
        with self.database.sessions() as session:
            return self.view(self._job(session,job_id))

    def used_disk_bytes(self):
        root = self.settings.import_directory
        size = 0
        for path in root.glob("*") if root.exists() else ():
            try:
                if path.is_file(): size += path.stat().st_size
            except FileNotFoundError: pass
        for suffix in ("","-wal","-shm"):
            path = Path(str(self.settings.database_path)+suffix)
            try: size += path.stat().st_size
            except FileNotFoundError: pass
        return size

    def ensure_disk(self, extra=0):
        if self.used_disk_bytes()+extra > self.settings.import_disk_quota_bytes:
            raise ImportErrorResponse("Import disk kotası aşıldı.",507)
        root = self.settings.database_path.parent
        root.mkdir(parents=True,exist_ok=True)
        if shutil.disk_usage(root).free < extra + 1024*1024:
            raise ImportErrorResponse("Geçici depolamada yeterli boş alan yok.",507)

    def reserve(self, workspace_id, expected_dataset_id=None, expected_generation_id=None, expected_revision=None):
        with self.database.sessions.begin() as session:
            # Reserve SQLite's writer before checking shared quotas.
            workspace = ProjectService(session)._workspace(workspace_id,lock=True)
            expected = (expected_dataset_id, expected_generation_id, expected_revision)
            if any(value is not None for value in expected):
                if any(value is None for value in expected):
                    raise ImportErrorResponse("Beklenen dataset, generation ve revision birlikte gönderilmeli.",422)
                source = ProjectService(session)._source(workspace,*expected)
            else:
                source = session.get(Dataset,workspace.active_dataset_id)
            pending = session.scalar(select(func.count(Job.id)).where(Job.status.in_(["uploading","queued","running"])))
            if pending >= self.settings.import_max_pending:
                raise ImportErrorResponse("Import kuyruğu dolu.",429)
            reservation = 3*self.settings.import_max_bytes
            reserved = session.scalar(select(func.coalesce(func.sum(Job.disk_reservation),0)))
            self.ensure_disk(reserved+reservation)
            job = Job(workspace_id=workspace_id,initial_dataset_id=source.id,
                      initial_generation_id=source.generation_id,initial_revision=source.revision,
                      disk_reservation=reservation,lease_expires_at=utc_now()+timedelta(seconds=self.settings.import_upload_lease_seconds))
            session.add(job)
            session.flush()
            return self.view(job)

    def begin_upload(self, job_id, workspace_id):
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            if job.workspace_id != workspace_id or job.status != "uploading" or job.cancel_requested or job.upload_token:
                raise RevisionConflictError("İş bu yükleme için uygun değil.")
            active = session.scalar(select(func.count(Job.id)).where(Job.status == "uploading",Job.upload_token.is_not(None)))
            if active >= self.settings.import_max_uploads:
                raise ImportErrorResponse("Eşzamanlı yükleme sınırı aşıldı.",429)
            token = str(uuid4())
            job.upload_token = token
            job.lease_expires_at = utc_now()+timedelta(seconds=self.settings.import_upload_lease_seconds)
            return token

    def upload_progress(self, job_id, token, *, received=None, uploaded=None, filename=None, total=None):
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            if job.status != "uploading" or job.upload_token != token or job.cancel_requested:
                raise ImportStopped("Dosya yükleme iptal edildi veya yükleme oturumu sona erdi.")
            if received is not None: job.received_bytes = received
            if uploaded is not None: job.uploaded_bytes = uploaded
            if filename is not None: job.filename = filename
            if total is not None: job.total_bytes = total
            job.lease_expires_at = utc_now()+timedelta(seconds=self.settings.import_upload_lease_seconds)

    def queue(self, job_id, token, total):
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            if job.status != "uploading" or job.upload_token != token or job.cancel_requested:
                raise ImportStopped("Yükleme iptal edildi.")
            job.total_bytes = job.uploaded_bytes = total
            job.status,job.upload_token,job.lease_expires_at = "queued",None,None
            job.disk_reservation = total*2
            session.flush()
            return self.view(job)

    def finish(self, job_id, status, error=None, *, token=None):
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            if job.activated_at is not None: return
            if token is not None and token not in (job.worker_token,job.upload_token): return
            job.status = "cancelled" if job.cancel_requested else status
            job.error = str(error)[:1000] if error else None
            job.finished_at = utc_now()
            job.upload_token = job.worker_token = job.lease_expires_at = None
            job.cleanup_pending = job.status in ("failed","cancelled")
            job.disk_reservation = 0
        for path in self.paths(job_id): path.unlink(missing_ok=True)

    def cancel(self, job_id):
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            if job.activated_at is not None:
                raise RevisionConflictError("Etkinleştirilmiş import iptal edilemez.")
            job.cancel_requested = True
            if job.status in ("queued","completed") or (job.status == "uploading" and job.upload_token is None):
                job.status,job.finished_at,job.cleanup_pending = "cancelled",utc_now(),True
                job.disk_reservation = 0
            session.flush()
            result = self.view(job)
        if result.status == "cancelled":
            for path in self.paths(job_id): path.unlink(missing_ok=True)
        return result

    def claim(self):
        token,now = str(uuid4()),utc_now()
        candidate = select(Job.id).where(Job.kind == "import",Job.status == "queued",Job.cancel_requested.is_(False)).order_by(Job.created_at,Job.id).limit(1).scalar_subquery()
        running = select(func.count(Job.id)).where(Job.status == "running").scalar_subquery()
        with self.database.sessions.begin() as session:
            identifier = session.scalar(update(Job).where(Job.id == candidate,Job.status == "queued",running < self.settings.import_max_running)
                .values(status="running",worker_token=token,started_at=now,progress_at=now,
                        lease_expires_at=now+timedelta(seconds=self.settings.import_lease_seconds)).returning(Job.id))
        return (identifier,token) if identifier else None

    def heartbeat(self, job_id, token, peak=0):
        with self.database.sessions.begin() as session:
            changed = session.execute(update(Job).where(Job.id == job_id,Job.status == "running",Job.worker_token == token)
                .values(lease_expires_at=utc_now()+timedelta(seconds=self.settings.import_lease_seconds),peak_rss_bytes=func.max(Job.peak_rss_bytes,peak)))
            return changed.rowcount == 1

    @staticmethod
    def owned(session, job_id, token):
        job = JobService._job(session,job_id,lock=True)
        if job.status != "running" or job.worker_token != token or job.cancel_requested:
            raise ImportStopped("Import iptal edildi veya worker oturumu sona erdi.")
        return job

    def pulse(self, job_id, token, processed):
        with self.database.sessions.begin() as session:
            job = self.owned(session,job_id,token)
            job.processed_bytes = min(processed,job.total_bytes)
            job.progress_at = utc_now()

    def activate(self, job_id):
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            workspace = ProjectService(session)._workspace(job.workspace_id,lock=True)
            if job.activated_at is not None:
                if workspace.active_dataset_id == job.staging_dataset_id:
                    return ProjectService(session).get_workspace(workspace.id)
                raise RevisionConflictError("Bu import daha önce etkinleştirildi; workspace sonradan değişti.")
            if job.status != "completed" or job.cancel_requested or job.staging_dataset_id is None:
                raise RevisionConflictError("Yalnızca tamamlanmış ve iptal edilmemiş iş etkinleştirilebilir.")
            source = session.get(Dataset,workspace.active_dataset_id)
            if (source.id,source.generation_id,source.revision) != (job.initial_dataset_id,job.initial_generation_id,job.initial_revision):
                raise RevisionConflictError("Workspace generation/revision değişti; import etkinleştirilmedi.")
            staged = session.get(Dataset,job.staging_dataset_id)
            if staged is None or staged.status != "staging":
                raise RevisionConflictError("Geçici veri kümesi hazır değil.")
            staged.status = "draft"
            job.retired_dataset_id = workspace.active_dataset_id
            workspace.active_dataset_id,workspace.updated_at = staged.id,utc_now()
            job.activated_at,job.cleanup_pending = utc_now(),True
            session.flush()
            # Old dataset deletion is deliberately deferred: activation stays short.
            return ProjectService(session).get_workspace(workspace.id)

    def recover(self):
        with self.database.sessions.begin() as session:
            expired = session.scalars(select(Job.id).where(Job.status.in_(["uploading","running"]),Job.lease_expires_at < utc_now())).all()
        for identifier in expired:
            with self.database.sessions.begin() as session:
                job = self._job(session,identifier,lock=True)
                if job.status not in ("uploading","running") or job.lease_expires_at is None or job.lease_expires_at >= utc_now(): continue
                job.status = "cancelled" if job.cancel_requested else "failed"
                job.error = "Yükleme/worker oturumu kesildi; süreli sahiplik sona erdi."
                job.finished_at,job.cleanup_pending,job.disk_reservation = utc_now(),True,0
                job.worker_token = job.upload_token = job.lease_expires_at = None

    def cleanup(self, job_id):
        with self.database.sessions() as session:
            job = self._job(session,job_id)
            if job.status not in ("failed","cancelled","completed"): return
            candidate = job.retired_dataset_id if job.activated_at else job.staging_dataset_id if job.status in ("failed","cancelled") else None
        for path in self.paths(job_id): path.unlink(missing_ok=True)
        if candidate:
            while True:
                with self.database.sessions.begin() as session:
                    # First acquire writer, then verify references before each batch.
                    job = self._job(session,job_id,lock=True)
                    referenced = session.scalar(select(exists().where(Project.saved_dataset_id == candidate))) or session.scalar(select(exists().where(Workspace.active_dataset_id == candidate)))
                    if referenced: break
                    ids = session.scalars(select(Feature.id).where(Feature.dataset_id == candidate).limit(self.settings.import_batch_size)).all()
                    if ids:
                        session.execute(delete(Feature).where(Feature.id.in_(ids)))
                    else:
                        session.execute(delete(Dataset).where(Dataset.id == candidate))
                        break
        with self.database.sessions.begin() as session:
            job = self._job(session,job_id,lock=True)
            job.cleanup_pending,job.retired_dataset_id,job.disk_reservation = False,None,0

    def maintain(self):
        self.recover()
        with self.database.sessions() as session:
            identifiers = session.scalars(select(Job.id).where(Job.cleanup_pending.is_(True))).all()
        for identifier in identifiers: self.cleanup(identifier)
        root = self.settings.import_directory
        if root.exists():
            for path in root.glob("*"):
                if not path.is_file(): continue
                try: identifier = str(__import__('uuid').UUID(path.stem))
                except ValueError: continue
                with self.database.sessions() as session:
                    job = session.get(Job,identifier)
                    terminal = job is not None and job.status in ("completed","failed","cancelled")
                if terminal or (job is None and time.time()-path.stat().st_mtime > self.settings.import_upload_lease_seconds):
                    path.unlink(missing_ok=True)
