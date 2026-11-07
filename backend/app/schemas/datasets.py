from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

Bounds = Annotated[list[float], Field(min_length=4, max_length=4)]


class ContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class DatasetSummary(ContractModel):
    name: str
    count: int
    vertices: int
    bounds: Bounds | None
    source_bytes: int = Field(alias="sourceBytes")
    revision: int


class FeatureSummary(ContractModel):
    id: str
    label: str
    geometry_type: str = Field(alias="geometryType")
    vertices: int
    bounds: Bounds | None


class FeatureRecord(ContractModel):
    summary: FeatureSummary
    feature: dict[str, Any]


class FeaturePage(ContractModel):
    items: list[FeatureSummary]
    total: int


class ViewportResult(ContractModel):
    records: list[FeatureRecord]
    matched: int
    limited: bool


class MutationResult(ContractModel):
    id: str
    record: FeatureRecord | None
    dataset: DatasetSummary


class CategoryGroup(ContractModel):
    name: str
    subcategories: list[str]


class CategoryMutationResult(ContractModel):
    catalog: list[CategoryGroup]
    dataset: DatasetSummary
