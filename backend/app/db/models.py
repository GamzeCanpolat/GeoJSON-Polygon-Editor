"""Persistent storage models. GeoJSON's external IDs are never primary keys."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    # SQLite DATETIME has no timezone. All stored timestamps use naive UTC.
    return datetime.now(UTC).replace(tzinfo=None)


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
        CheckConstraint("count >= 0", name="count_nonnegative"),
        CheckConstraint("vertices >= 0", name="vertices_nonnegative"),
        CheckConstraint("source_bytes >= 0", name="source_bytes_nonnegative"),
        CheckConstraint("next_ordinal >= 0 AND next_ordinal <= 9007199254740991", name="ordinal_range"),
        CheckConstraint("status IN ('draft', 'staging', 'snapshot')", name="status_values"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    generation_id: Mapped[str] = mapped_column(String(36), default=new_id, index=True)
    name: Mapped[str] = mapped_column(String, default="Adsız çalışma.geojson")
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    vertices: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    bounds: Mapped[list[float] | None] = mapped_column(JSON(none_as_null=True))
    source_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    next_ordinal: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    features: Mapped[list["Feature"]] = relationship(back_populates="dataset", cascade="all, delete-orphan", passive_deletes=True)
    categories: Mapped[list["Category"]] = relationship(back_populates="dataset", cascade="all, delete-orphan", passive_deletes=True)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (CheckConstraint("version >= 1", name="version_positive"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    saved_dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id", ondelete="RESTRICT"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    saved_dataset: Mapped[Dataset | None] = relationship()
    workspaces: Mapped[list["Workspace"]] = relationship(back_populates="project", passive_deletes="all")


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    active_dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="RESTRICT"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    project: Mapped[Project | None] = relationship(back_populates="workspaces")
    active_dataset: Mapped[Dataset] = relationship()


class Feature(Base):
    __tablename__ = "features"
    __table_args__ = (
        UniqueConstraint("dataset_id", "ordinal"),
        CheckConstraint("ordinal >= 0 AND ordinal <= 9007199254740991", name="ordinal_range"),
        CheckConstraint("vertices >= 0", name="vertices_nonnegative"),
        CheckConstraint("is_deleted IN (0, 1)", name="deleted_boolean"),
        Index("ix_features_dataset_live_ordinal", "dataset_id", "is_deleted", "ordinal"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    feature_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    geometry_type: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String)
    vertices: Mapped[int] = mapped_column(Integer)
    bounds: Mapped[list[float] | None] = mapped_column(JSON(none_as_null=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    dataset: Mapped[Dataset] = relationship(back_populates="features")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("dataset_id", "normalized_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String)

    dataset: Mapped[Dataset] = relationship(back_populates="categories")
    subcategories: Mapped[list["Subcategory"]] = relationship(back_populates="category", cascade="all, delete-orphan", passive_deletes=True)


class Subcategory(Base):
    __tablename__ = "subcategories"
    __table_args__ = (UniqueConstraint("category_id", "normalized_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String)

    category: Mapped[Category] = relationship(back_populates="subcategories")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint("status IN ('uploading','queued','running','completed','failed','cancelled')", name="status_values"),
        CheckConstraint("total_bytes >= 0 AND processed_bytes >= 0 AND processed_bytes <= total_bytes", name="byte_progress"),
        CheckConstraint("processed_features >= 0 AND disk_reservation >= 0", name="counters_nonnegative"),
        Index("ix_jobs_status_created", "status", "created_at"),
        Index("ix_jobs_status_lease", "status", "lease_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="import", server_default="import")
    status: Mapped[str] = mapped_column(String(16), default="uploading", server_default="uploading")
    filename: Mapped[str] = mapped_column(String, default="upload.geojson")
    total_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    received_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    uploaded_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    processed_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    processed_features: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    disk_reservation: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    cleanup_pending: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    staging_dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id", ondelete="SET NULL"), index=True)
    retired_dataset_id: Mapped[str | None] = mapped_column(String(36))
    initial_dataset_id: Mapped[str] = mapped_column(String(36))
    initial_generation_id: Mapped[str] = mapped_column(String(36))
    initial_revision: Mapped[int] = mapped_column(Integer)
    upload_token: Mapped[str | None] = mapped_column(String(36))
    worker_token: Mapped[str | None] = mapped_column(String(36))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    progress_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime)
    error: Mapped[str | None] = mapped_column(String)
    warning_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    invalid_features: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    warning_samples: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default="[]")
    peak_rss_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
