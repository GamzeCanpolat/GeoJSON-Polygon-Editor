from typing import Annotated, Any

from pydantic import Field, field_validator, model_validator

from app.domain.categories import trim_name
from app.schemas.projects import WorkspaceState


class MutationRequest(WorkspaceState):
    id: str | None = Field(default=None,min_length=1,max_length=100)
    feature: dict[str,Any] | None

    @model_validator(mode='after')
    def deletion_requires_id(self):
        if self.id is None and self.feature is None:
            raise ValueError('Silme işlemi için bir şekil kimliği gerekli.')
        return self


class AddCategoryRequest(WorkspaceState):
    name: str = Field(min_length=1,max_length=80)
    parent: str | None = Field(default=None,min_length=1,max_length=4096)

    @field_validator('name','parent',mode='before')
    @classmethod
    def trim(cls,value):
        if value is None or not isinstance(value,str): return value
        value=trim_name(value)
        if not value: raise ValueError('Kategori adı boş olamaz.')
        return value
