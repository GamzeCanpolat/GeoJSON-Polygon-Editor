from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.projects import CreateProjectRequest, ProjectPage, ProjectResponse, RenameProjectRequest, SaveProjectRequest
from app.services.projects import ProjectService

router = APIRouter(prefix="/projects", tags=["Projects"], responses={
    404: {"description": "Proje veya workspace bulunamadı"},
    409: {"description": "Proje sürümü veya workspace durumu değişti"},
    503: {"description": "Veritabanı işlemi tamamlanamadı"},
})
SessionDependency = Annotated[Session, Depends(get_session)]


def workspace_state(payload: CreateProjectRequest | SaveProjectRequest) -> dict:
    return {
        "expected_dataset_id": str(payload.expected_dataset_id),
        "expected_generation_id": str(payload.expected_generation_id),
        "expected_revision": payload.expected_revision,
    }


@router.get("", response_model=ProjectPage)
def list_projects(session: SessionDependency, search: str = "", offset: Annotated[int, Query(ge=0)] = 0,
                  limit: Annotated[int, Query(ge=1, le=100)] = 50) -> ProjectPage:
    return ProjectService(session).list_projects(search=search, offset=offset, limit=limit)


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: CreateProjectRequest, session: SessionDependency) -> ProjectResponse:
    with session.begin():
        result = ProjectService(session).create_project(str(payload.workspace_id), payload.name, **workspace_state(payload))
    return result


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID, session: SessionDependency) -> ProjectResponse:
    return ProjectService(session).get_project(str(project_id))


@router.patch("/{project_id}", response_model=ProjectResponse)
def rename_project(project_id: UUID, payload: RenameProjectRequest, session: SessionDependency) -> ProjectResponse:
    with session.begin():
        result = ProjectService(session).rename_project(str(project_id), payload.name, expected_version=payload.expected_version)
    return result


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_project(project_id: UUID, session: SessionDependency,
                   expected_version: Annotated[int, Query(alias="expectedVersion", ge=1)]) -> Response:
    with session.begin():
        ProjectService(session).delete_project(str(project_id), expected_version=expected_version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{project_id}/content", response_model=ProjectResponse)
def save_project(project_id: UUID, payload: SaveProjectRequest, session: SessionDependency) -> ProjectResponse:
    with session.begin():
        result = ProjectService(session).save_project(
            str(project_id), str(payload.workspace_id), expected_version=payload.expected_version, **workspace_state(payload),
        )
    return result
