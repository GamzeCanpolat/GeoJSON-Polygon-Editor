from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.schemas.datasets import ContractModel


class GeoJsonFeatureInput(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: Literal["Feature"]
    geometry: dict[str, Any] | None
    properties: dict[str, Any] | None


class GeoJsonCollectionInput(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: Literal["FeatureCollection"]
    features: list[GeoJsonFeatureInput]


DOCUMENT_ADAPTER = TypeAdapter(GeoJsonFeatureInput | GeoJsonCollectionInput)


def document_schema() -> dict:
    """Inline Pydantic references for the manually size-limited request body."""
    schema = DOCUMENT_ADAPTER.json_schema()
    definitions = schema.pop("$defs", {})
    def inline(value):
        if isinstance(value, dict):
            if "$ref" in value:
                return inline(definitions[value["$ref"].split("/")[-1]])
            return {key: inline(child) for key, child in value.items()}
        if isinstance(value, list):
            return [inline(child) for child in value]
        return value
    return inline(schema)


class ValidationIssue(ContractModel):
    code: str
    message: str
    path: str
    location: list[float] | None = Field(default=None, min_length=2, max_length=2)
    reason: str | None = None
    feature_index: int | None = Field(default=None, alias="featureIndex")
    feature_id: str | None = Field(default=None, alias="featureId")


class GeometryValidationResult(ContractModel):
    valid: bool
    geometry_type: str | None = Field(alias="geometryType")
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]
    message: str
    feature_index: int | None = Field(default=None, alias="featureIndex")
    feature_id: str | None = Field(default=None, alias="featureId")
    location: list[float] | None = Field(default=None, min_length=2, max_length=2)


class GeometryValidationReport(GeometryValidationResult):
    results: list[GeometryValidationResult]
    feature_count: int = Field(alias="featureCount")
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    dataset_id: str | None = Field(default=None, alias="datasetId")
    generation_id: str | None = Field(default=None, alias="generationId")
    revision: int | None = None
