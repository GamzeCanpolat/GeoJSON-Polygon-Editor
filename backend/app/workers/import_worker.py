import argparse
import json
import logging
import multiprocessing
import os
import signal
from threading import Event, Thread
import time

import psutil
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.db.models import Category, Dataset, Job, Subcategory, utc_now
from app.db.session import Database
from app.domain.categories import validate_catalog
from app.domain.geojson import describe_feature, prepare_feature
from app.domain.streaming_geojson import stream_collection
from app.domain.topology import validate_topology
from app.services.catalog import CatalogStore
from app.services.datasets import DatasetService
from app.services.jobs import ImportStopped, JobService

logger = logging.getLogger(__name__)


class ProgressReader:
    def __init__(self, source, chunk_size, pulse):
        self.source,self.chunk_size,self.pulse = source,chunk_size,pulse
        self.bytes_read = 0
        self._position = 0
        self.last_pulse = 0.0

    def read(self, size=-1):
        if size == 0: return b""
        chunk = self.source.read(min(self.chunk_size,size) if size > 0 else self.chunk_size)
        self._position += len(chunk)
        # The root discriminator may replay a type-last document. Report the
        # file-offset high-water mark, never count the same bytes twice.
        self.bytes_read = max(self.bytes_read, self._position)
        if not chunk or time.monotonic()-self.last_pulse >= 0.25:
            self.pulse(self.bytes_read)
            self.last_pulse = time.monotonic()
        return chunk

    def tell(self):
        return self._position

    def seek(self, offset, whence=0):
        self._position = self.source.seek(offset, whence)
        return self._position

    def readinto(self, buffer):
        chunk = self.read(len(buffer))
        buffer[:len(chunk)] = chunk
        return len(chunk)


def _has_z(geometry):
    stack = [geometry]
    while stack:
        node = stack.pop()
        if isinstance(node,dict):
            stack.extend(node.get("geometries",[]) if node.get("type")=="GeometryCollection" else [node.get("coordinates",[])])
        elif isinstance(node,list) and node:
            if isinstance(node[0],(int,float)):
                if len(node)>2: return True
            else: stack.extend(node)
    return False


def run_import(settings, job_id, token, parent_pid=None):
    """Isolated processing child: no active workspace or project writes."""
    # On macOS, killing the coordinator does not automatically kill its child.
    # Stop an orphan even if GEOS is executing; durable lease recovery cleans DB.
    stop_parent_watch = Event()
    def watch_parent():
        while not stop_parent_watch.wait(.1):
            if os.getppid()!=parent_pid: os._exit(72)
    if parent_pid is not None and os.getppid()!=parent_pid: os._exit(72)
    watcher = Thread(target=watch_parent,daemon=True) if parent_pid is not None else None
    if watcher is not None: watcher.start()
    database = Database(settings)
    jobs = JobService(database,settings)
    try:
        with database.sessions.begin() as session:
            job = jobs.owned(session,job_id,token)
            staged = Dataset(name=job.filename,status="staging",source_bytes=job.total_bytes)
            session.add(staged)
            session.flush()
            job.staging_dataset_id = staged.id
            staged_id,generation,total_bytes = staged.id,staged.generation_id,job.total_bytes
        source_path = jobs.paths(job_id)[1]
        if source_path.stat().st_size != total_bytes:
            raise ValueError("Yüklenen dosya boyutu job kaydıyla uyuşmuyor.")
        batch,batch_bytes = [],0
        warning_count,invalid_count,samples = 0,0,[]
        vertices,count = 0,0
        def flush(reader):
            nonlocal batch,batch_bytes,warning_count,invalid_count,samples
            if not batch: return
            jobs.ensure_disk(extra=batch_bytes*2)
            with database.sessions.begin() as session:
                job = jobs.owned(session,job_id,token)
                service = DatasetService(session)
                service.append_staging_batch(staged_id,batch)
                categories = session.scalar(select(func.count(Category.id)).where(Category.dataset_id==staged_id))
                categories += session.scalar(select(func.count(Subcategory.id)).join(Category).where(Category.dataset_id==staged_id))
                if categories > settings.import_max_categories: raise ValueError("Kategori sayısı sınırı aşıldı.")
                job.processed_features += len(batch)
                job.processed_bytes = min(reader.bytes_read,job.total_bytes)
                job.progress_at = utc_now()
                job.warning_count += warning_count
                job.invalid_features += invalid_count
                combined = job.warning_samples+samples
                combined.sort(key=lambda issue: issue.get('severity')!='topology_error')
                job.warning_samples = combined[:settings.import_warning_samples]
            batch,batch_bytes,warning_count,invalid_count,samples = [],0,0,0,[]
        with source_path.open("rb") as source:
            reader = ProgressReader(source,settings.import_chunk_bytes,lambda amount: jobs.pulse(job_id,token,amount))
            for kind,value,_estimated in stream_collection(reader,settings):
                if kind == "metadata":
                    flush(reader)
                    catalog = validate_catalog(value["category_catalog"]) if "category_catalog" in value else []
                    if any(len(name)>settings.import_max_category_chars or any(len(child)>settings.import_max_category_chars for child in children) for name,children in catalog):
                        raise ValueError("Import kategori adı uzunluk sınırı aşıldı.")
                    metadata = {key:item for key,item in value.items() if key not in ("type","category_catalog")}
                    if len(json.dumps(metadata,ensure_ascii=False,allow_nan=False).encode("utf-8")) > settings.import_max_metadata_bytes:
                        raise ValueError("Kök metadata sınırı aşıldı.")
                    jobs.ensure_disk(extra=settings.import_max_metadata_bytes*2)
                    with database.sessions.begin() as session:
                        job = jobs.owned(session,job_id,token)
                        staged = session.get(Dataset,staged_id)
                        store = CatalogStore(session,staged_id)
                        for name,children in catalog:
                            store.include(name)
                            for child in children: store.include(name,child)
                        category_count = session.scalar(select(func.count(Category.id)).where(Category.dataset_id==staged_id))
                        category_count += session.scalar(select(func.count(Subcategory.id)).join(Category).where(Category.dataset_id==staged_id))
                        if category_count > settings.import_max_categories: raise ValueError("Kategori sayısı sınırı aşıldı.")
                        staged.metadata_json = metadata
                        job.processed_bytes,job.progress_at = job.total_bytes,utc_now()
                        job.status,job.finished_at = "completed",utc_now()
                        job.worker_token,job.lease_expires_at,job.disk_reservation = None,None,0
                    try: source_path.unlink(missing_ok=True)
                    except OSError: pass
                    return
                clean = prepare_feature(value)
                properties = clean['properties'] or {}
                if any(isinstance(properties.get(key),str) and len(properties[key])>settings.import_max_category_chars for key in ('ana_kategori','alt_kategori','kategori')):
                    raise ValueError("Import kategori adı uzunluk sınırı aşıldı.")
                size = len(json.dumps(clean,ensure_ascii=False,allow_nan=False,separators=(",",":")).encode("utf-8"))
                if size > settings.import_max_feature_bytes: raise ValueError("Tek Feature boyut sınırı aşıldı.")
                vertex_count = describe_feature(clean,count)[2]
                vertices += vertex_count
                if vertex_count > settings.import_max_feature_vertices or vertices > settings.import_max_vertices:
                    raise ValueError("Import koordinat sayısı sınırı aşıldı.")
                if count >= settings.import_max_features: raise ValueError("Import Feature sayısı sınırı aşıldı.")
                if batch and (len(batch)>=settings.import_batch_size or batch_bytes+size>settings.import_batch_bytes): flush(reader)
                diagnostic = validate_topology({"geometry":clean["geometry"],"hasZ":_has_z(clean["geometry"]),
                    "featureIndex":count,"featureId":f"{generation}:{count}"},20)
                issues = [{**issue,'severity':'topology_error'} for issue in diagnostic['errors']]+[{**issue,'severity':'warning'} for issue in diagnostic['warnings']]
                warning_count += len(issues)
                invalid_count += not diagnostic['valid']
                samples = sorted(samples+issues,key=lambda issue:issue['severity']!='topology_error')[:settings.import_warning_samples]
                batch.append(clean)
                batch_bytes += size
                count += 1
            raise ValueError("GeoJSON tamamlanamadı.")
    except ImportStopped as error:
        jobs.finish(job_id,"cancelled",error,token=token)
    except Exception as error:
        jobs.finish(job_id,"failed",str(error)[:1000],token=token)
    finally:
        database.dispose()
        stop_parent_watch.set()
        if watcher is not None: watcher.join(1)


class ImportWorker:
    def __init__(self, settings):
        self.settings = settings
        self.database = Database(settings)
        self.jobs = JobService(self.database,settings)
        self.stopping = False

    def close(self):
        self.database.dispose()

    def run_once(self):
        self.jobs.maintain()
        claimed = self.jobs.claim()
        if claimed is None: return False
        job_id,token = claimed
        logger.info("Import %s başladı",job_id)
        process = multiprocessing.get_context("spawn").Process(target=run_import,args=(self.settings,job_id,token,os.getpid()))
        started,last_heartbeat = time.monotonic(),0.0
        peak,stop_reason = 0,None
        try:
            process.start()
            monitored = psutil.Process(process.pid)
            while process.is_alive():
                try: peak = max(peak,monitored.memory_info().rss)
                except psutil.NoSuchProcess: pass
                with self.database.sessions() as session:
                    job = session.get(Job,job_id)
                    status,cancel,progress_at = job.status,job.cancel_requested,job.progress_at
                if self.stopping: stop_reason = "Worker durduruldu."
                elif cancel: stop_reason = "Import iptal edildi."
                elif peak > self.settings.import_worker_memory_bytes: stop_reason = "Import worker bellek sınırı aşıldı."
                elif time.monotonic()-started > self.settings.import_job_timeout_seconds: stop_reason = "Import toplam süre sınırı aşıldı."
                elif status=="running" and progress_at and (utc_now()-progress_at).total_seconds()>self.settings.import_stall_seconds:
                    stop_reason = "Import işlem/GEOS ilerleme süresi aşıldı."
                if stop_reason: break
                if time.monotonic()-last_heartbeat > min(2,self.settings.import_lease_seconds/3):
                    if not self.jobs.heartbeat(job_id,token,peak) and status not in ("completed","failed","cancelled"):
                        stop_reason = "Worker iş sahipliği sona erdi."
                        break
                    last_heartbeat = time.monotonic()
                process.join(0.1)
        except Exception as error:
            stop_reason = str(error)
        finally:
            if process.pid is not None:
                if process.is_alive():
                    process.terminate()
                    process.join(2)
                    if process.is_alive(): process.kill()
                process.join()
                process.close()
            with self.database.sessions.begin() as session:
                session.execute(update(Job).where(Job.id==job_id).values(peak_rss_bytes=func.max(Job.peak_rss_bytes,peak)))
            result = self.jobs.get(job_id)
            if result.status == "running":
                self.jobs.finish(job_id,"failed",stop_reason or "Worker beklenmedik biçimde kapandı.",token=token)
            self.jobs.maintain()
            result = self.jobs.get(job_id)
            logger.info("Import %s: %s, %s Feature",job_id,result.status,result.processed_features)
        return True


def main():
    parser = argparse.ArgumentParser(description="GeoJSON SQLite import worker")
    parser.add_argument("--once",action="store_true",help="En çok bir iş çalıştırıp çık")
    parser.add_argument("--poll-interval",type=float,default=1)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    worker = ImportWorker(Settings())
    def stop(_signum,_frame): worker.stopping = True
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    try:
        while not worker.stopping:
            try:
                handled = worker.run_once()
            except (SQLAlchemyError,OSError):
                logger.exception("Worker kuyruğuna erişilemedi; kalıcı durum sonraki turda yeniden denetlenecek")
                if args.once: raise
                handled = False
            if args.once: break
            if not handled: time.sleep(max(0.05,args.poll_interval))
    finally:
        worker.close()


if __name__ == "__main__":
    main()
