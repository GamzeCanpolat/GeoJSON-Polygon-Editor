"""Workspace/project aggregate. SAVEPOINTs are atomic; callers commit once.

Write operations first reserve SQLite's writer using a no-op row update, before
reading source data. This prevents a copy from mixing concurrent revisions.
"""
from datetime import UTC

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db.models import Dataset, Project, Workspace, utc_now
from app.domain.categories import trim_name, turkish_lower
from app.schemas.projects import ProjectPage, ProjectResponse, ProjectSummary, WorkspaceResponse
from app.services.datasets import DatasetService
from app.services.errors import NotFoundError, RevisionConflictError
from app.services.snapshots import copy_dataset, remove_unreferenced_dataset


class ProjectService:
    def __init__(self, session: Session):
        self.session = session
        self.datasets = DatasetService(session)

    def _workspace(self, workspace_id: str, *, lock: bool = False) -> Workspace:
        if lock:
            self.session.execute(update(Workspace).where(Workspace.id == workspace_id).values(
                updated_at=Workspace.updated_at,
            ).execution_options(synchronize_session=False))
        workspace = self.session.get(Workspace, workspace_id, populate_existing=True)
        if workspace is None:
            raise NotFoundError("Çalışma alanı bulunamadı.")
        return workspace

    def _project(self, project_id: str, *, expected_version: int | None = None, lock: bool = False) -> Project:
        if lock:
            self.session.execute(update(Project).where(Project.id == project_id).values(
                version=Project.version, updated_at=Project.updated_at,
            ).execution_options(synchronize_session=False))
        project = self.session.get(Project, project_id, populate_existing=True)
        if project is None:
            raise NotFoundError("Proje bulunamadı.")
        if expected_version is not None and project.version != expected_version:
            raise RevisionConflictError("Proje sürümü değişti. Güncel projeyi yeniden okuyun.")
        return project

    def _saved(self, project: Project) -> Dataset:
        if project.saved_dataset_id is None:
            raise RevisionConflictError("Projenin kayıtlı veri kümesi yok.")
        dataset = self.datasets.get_dataset(project.saved_dataset_id)
        if dataset.status != "snapshot":
            raise RevisionConflictError("Projenin kayıtlı veri kümesi snapshot olmalı.")
        return dataset

    def _source(self, workspace: Workspace, dataset_id: str, generation_id: str, revision: int) -> Dataset:
        dataset = self.datasets.get_dataset(workspace.active_dataset_id)
        if (dataset.id, dataset.generation_id, dataset.revision) != (dataset_id, generation_id, revision):
            raise RevisionConflictError("Çalışma alanı değişti. Güncel dataset bilgilerini yeniden okuyun.")
        if dataset.status != "draft":
            raise RevisionConflictError("Çalışma alanının veri kümesi düzenlenebilir taslak olmalı.")
        return dataset

    @staticmethod
    def _name(name: str) -> str:
        if not isinstance(name, str) or not 1 <= len(trim_name(name)) <= 200:
            raise ValueError("Proje adı 1–200 karakter olmalı.")
        return trim_name(name)

    def _workspace_response(self, workspace: Workspace) -> WorkspaceResponse:
        dataset = self.datasets.get_dataset(workspace.active_dataset_id)
        return WorkspaceResponse(
            id=workspace.id, project_id=workspace.project_id, active_dataset_id=dataset.id,
            generation_id=dataset.generation_id, dataset=self.datasets.summary(dataset.id),
            created_at=workspace.created_at.replace(tzinfo=UTC), updated_at=workspace.updated_at.replace(tzinfo=UTC),
        )

    @staticmethod
    def _project_summary(project: Project) -> ProjectSummary:
        if project.saved_dataset_id is None:
            raise RevisionConflictError("Projenin kayıtlı veri kümesi yok.")
        return ProjectSummary(
            id=project.id, name=project.name, saved_dataset_id=project.saved_dataset_id, version=project.version,
            created_at=project.created_at.replace(tzinfo=UTC), updated_at=project.updated_at.replace(tzinfo=UTC),
        )

    def _project_response(self, project: Project) -> ProjectResponse:
        dataset = self._saved(project)
        return ProjectResponse(**self._project_summary(project).model_dump(),
                               generation_id=dataset.generation_id, dataset=self.datasets.summary(dataset.id))

    def create_workspace(self, *, project_id: str | None = None,
                         expected_project_version: int | None = None) -> WorkspaceResponse:
        if (project_id is None) != (expected_project_version is None):
            raise ValueError("Proje ve beklenen sürüm birlikte verilmeli.")
        with self.session.begin_nested():
            if project_id is None:
                dataset = self.datasets.create_dataset()
            else:
                project = self._project(project_id, expected_version=expected_project_version, lock=True)
                dataset = copy_dataset(self.session, self._saved(project), status="draft")
            workspace = Workspace(active_dataset_id=dataset.id, project_id=project_id)
            self.session.add(workspace)
            self.session.flush()
            return self._workspace_response(workspace)

    def get_workspace(self, workspace_id: str) -> WorkspaceResponse:
        return self._workspace_response(self._workspace(workspace_id))

    def get_project(self, project_id: str) -> ProjectResponse:
        return self._project_response(self._project(project_id))

    def list_projects(self, *, search: str = "", offset: int = 0, limit: int = 50) -> ProjectPage:
        if offset < 0 or not 1 <= limit <= 100:
            raise ValueError("Geçersiz sayfalama.")
        query = select(Project)
        term = turkish_lower(trim_name(search))
        if term:
            query = query.where(func.instr(func.geojson_tr_lower(Project.name), term) > 0)
        total = self.session.scalar(select(func.count()).select_from(query.subquery()))
        rows = self.session.scalars(query.order_by(Project.updated_at.desc(), Project.id).offset(offset).limit(limit))
        return ProjectPage(items=[self._project_summary(project) for project in rows], total=total)

    def create_project(self, workspace_id: str, name: str, *, expected_dataset_id: str,
                       expected_generation_id: str, expected_revision: int) -> ProjectResponse:
        name = self._name(name)
        with self.session.begin_nested():
            workspace = self._workspace(workspace_id, lock=True)
            source = self._source(workspace, expected_dataset_id, expected_generation_id, expected_revision)
            snapshot = copy_dataset(self.session, source, status="snapshot")
            project = Project(name=name, saved_dataset_id=snapshot.id)
            self.session.add(project)
            self.session.flush()
            workspace.project_id = project.id
            workspace.updated_at = utc_now()
            self.session.flush()
            return self._project_response(project)

    def save_project(self, project_id: str, workspace_id: str, *, expected_version: int,
                     expected_dataset_id: str, expected_generation_id: str, expected_revision: int) -> ProjectResponse:
        with self.session.begin_nested():
            workspace = self._workspace(workspace_id, lock=True)
            project = self._project(project_id, expected_version=expected_version)
            if workspace.project_id != project.id:
                raise RevisionConflictError("Çalışma alanı bu projeye bağlı değil. Önce projeyi açın.")
            source = self._source(workspace, expected_dataset_id, expected_generation_id, expected_revision)
            snapshot = copy_dataset(self.session, source, status="snapshot")
            old_dataset_id = project.saved_dataset_id
            changed = self.session.execute(update(Project).where(
                Project.id == project.id, Project.version == expected_version,
            ).values(saved_dataset_id=snapshot.id, version=Project.version + 1, updated_at=utc_now())
              .execution_options(synchronize_session=False))
            if changed.rowcount != 1:
                raise RevisionConflictError("Proje sürümü değişti.")
            workspace.updated_at = utc_now()
            self.session.flush()
            self.session.refresh(project)
            if old_dataset_id is not None:
                remove_unreferenced_dataset(self.session, old_dataset_id)
            return self._project_response(project)

    def open_project(self, workspace_id: str, project_id: str, *, expected_project_version: int,
                     expected_dataset_id: str, expected_generation_id: str, expected_revision: int) -> WorkspaceResponse:
        with self.session.begin_nested():
            workspace = self._workspace(workspace_id, lock=True)
            self._source(workspace, expected_dataset_id, expected_generation_id, expected_revision)
            project = self._project(project_id, expected_version=expected_project_version)
            dataset = copy_dataset(self.session, self._saved(project), status="draft")
            old_dataset_id = workspace.active_dataset_id
            workspace.active_dataset_id = dataset.id
            workspace.project_id = project.id
            workspace.updated_at = utc_now()
            self.session.flush()
            remove_unreferenced_dataset(self.session, old_dataset_id)
            return self._workspace_response(workspace)

    def rename_project(self, project_id: str, name: str, *, expected_version: int) -> ProjectResponse:
        name = self._name(name)
        with self.session.begin_nested():
            project = self._project(project_id, expected_version=expected_version, lock=True)
            self.session.execute(update(Project).where(Project.id == project.id, Project.version == expected_version)
                                 .values(name=name, version=Project.version + 1, updated_at=utc_now())
                                 .execution_options(synchronize_session=False))
            self.session.refresh(project)
            return self._project_response(project)

    def delete_project(self, project_id: str, *, expected_version: int) -> None:
        with self.session.begin_nested():
            project = self._project(project_id, expected_version=expected_version, lock=True)
            dataset_id = project.saved_dataset_id
            self.session.execute(delete(Project).where(Project.id == project.id, Project.version == expected_version)
                                 .execution_options(synchronize_session=False))
            self.session.flush()
            if dataset_id is not None:
                remove_unreferenced_dataset(self.session, dataset_id)
