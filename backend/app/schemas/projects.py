from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.domain.categories import trim_name
from app.schemas.datasets import ContractModel, DatasetSummary

Revision = Annotated[int, Field(strict=True, ge=0)]
Version = Annotated[int, Field(strict=True, ge=1)]


class RequestModel(ContractModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class WorkspaceState(RequestModel):
    expected_dataset_id: UUID = Field(alias="expectedDatasetId")
    expected_generation_id: UUID = Field(alias="expectedGenerationId")
    expected_revision: Revision = Field(alias="expectedRevision")


class NamedRequest(RequestModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        name = trim_name(name)
        if not name:
            raise ValueError("Proje adı boş olamaz.")
        return name


class CreateWorkspaceRequest(RequestModel):
    project_id: UUID | None = Field(default=None, alias="projectId")
    expected_project_version: Version | None = Field(default=None, alias="expectedProjectVersion")

    @model_validator(mode="after")
    def require_version_with_project(self) -> Self:
        if (self.project_id is None) != (self.expected_project_version is None):
            raise ValueError("projectId ve expectedProjectVersion birlikte gönderilmeli.")
        return self


class CreateProjectRequest(WorkspaceState, NamedRequest):
    workspace_id: UUID = Field(alias="workspaceId")


class SaveProjectRequest(WorkspaceState):
    workspace_id: UUID = Field(alias="workspaceId")
    expected_version: Version = Field(alias="expectedVersion")


class RenameProjectRequest(NamedRequest):
    expected_version: Version = Field(alias="expectedVersion")


class OpenProjectRequest(WorkspaceState):
    project_id: UUID = Field(alias="projectId")
    expected_project_version: Version = Field(alias="expectedProjectVersion")


class WorkspaceResponse(ContractModel):
    id: str
    project_id: str | None = Field(alias="projectId")
    active_dataset_id: str = Field(alias="activeDatasetId")
    generation_id: str = Field(alias="generationId")
    dataset: DatasetSummary
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class ProjectSummary(ContractModel):
    id: str
    name: str
    saved_dataset_id: str = Field(alias="savedDatasetId")
    version: int
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class ProjectResponse(ProjectSummary):
    generation_id: str = Field(alias="generationId")
    dataset: DatasetSummary


class ProjectPage(ContractModel):
    items: list[ProjectSummary]
    total: int
