from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.projects import CreateWorkspaceRequest, OpenProjectRequest, WorkspaceResponse
from app.services.projects import ProjectService

router = APIRouter(prefix="/workspaces", tags=["Workspaces"], responses={
    404: {"description": "Proje veya workspace bulunamadı"},
    409: {"description": "Proje sürümü veya workspace durumu değişti"},
    503: {"description": "Veritabanı işlemi tamamlanamadı"},
})
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
def create_workspace(session: SessionDependency,
                     payload: CreateWorkspaceRequest = Body(default_factory=CreateWorkspaceRequest)) -> WorkspaceResponse:
    with session.begin():
        result = ProjectService(session).create_workspace(
            project_id=str(payload.project_id) if payload.project_id is not None else None,
            expected_project_version=payload.expected_project_version,
        )
    return result


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
def get_workspace(workspace_id: UUID, session: SessionDependency) -> WorkspaceResponse:
    return ProjectService(session).get_workspace(str(workspace_id))


@router.post("/{workspace_id}/open-project", response_model=WorkspaceResponse)
def open_project(workspace_id: UUID, payload: OpenProjectRequest, session: SessionDependency) -> WorkspaceResponse:
    with session.begin():
        result = ProjectService(session).open_project(
            str(workspace_id), str(payload.project_id), expected_project_version=payload.expected_project_version,
            expected_dataset_id=str(payload.expected_dataset_id),
            expected_generation_id=str(payload.expected_generation_id), expected_revision=payload.expected_revision,
        )
    return result
