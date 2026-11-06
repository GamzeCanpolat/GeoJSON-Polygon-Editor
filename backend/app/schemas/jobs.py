from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.schemas.datasets import ContractModel


class JobResponse(ContractModel):
    id: str
    workspace_id: str = Field(alias="workspaceId")
    kind: Literal["import"]
    status: Literal["uploading", "queued", "running", "completed", "failed", "cancelled"]
    filename: str
    total_bytes: int = Field(alias="totalBytes")
    received_bytes: int = Field(alias="receivedBytes")
    uploaded_bytes: int = Field(alias="uploadedBytes")
    processed_bytes: int = Field(alias="processedBytes")
    processed_features: int = Field(alias="processedFeatures")
    cancel_requested: bool = Field(alias="cancelRequested")
    cleanup_pending: bool = Field(alias="cleanupPending")
    staging_dataset_id: str | None = Field(alias="stagingDatasetId")
    initial_dataset_id: str = Field(alias="initialDatasetId")
    initial_generation_id: str = Field(alias="initialGenerationId")
    initial_revision: int = Field(alias="initialRevision")
    created_at: datetime = Field(alias="createdAt")
    started_at: datetime | None = Field(alias="startedAt")
    finished_at: datetime | None = Field(alias="finishedAt")
    activated_at: datetime | None = Field(alias="activatedAt")
    error: str | None
    warning_count: int = Field(alias="warningCount")
    invalid_features: int = Field(alias="invalidFeatures")
    warning_samples: list[dict[str, Any]] = Field(alias="warningSamples")
    peak_rss_bytes: int = Field(alias="peakRssBytes")
