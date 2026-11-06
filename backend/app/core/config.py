from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GEOJSON_",
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_path: Path = BACKEND_DIR / "var/database/projects.db"
    sqlite_busy_timeout_ms: int = Field(default=5000, ge=1, le=120_000)
    validation_max_bytes: int = Field(default=5 * 1024 * 1024, ge=128, le=100 * 1024 * 1024)
    validation_max_features: int = Field(default=500, ge=1, le=10_000)
    validation_max_vertices: int = Field(default=100_000, ge=1, le=1_000_000)
    validation_max_feature_vertices: int = Field(default=50_000, ge=1, le=1_000_000)
    validation_max_depth: int = Field(default=64, ge=4, le=128)
    validation_max_nodes: int = Field(default=250_000, ge=10, le=2_000_000)
    validation_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    validation_max_issues_per_feature: int = Field(default=20, ge=1, le=100)
    validation_max_concurrent: int = Field(default=2, ge=1, le=8)
    repository_max_feature_bytes: int = Field(default=2*1024*1024,ge=128,le=100*1024*1024)
    repository_max_feature_vertices: int = Field(default=100_000,ge=1,le=1_000_000)
    repository_max_depth: int = Field(default=64,ge=4,le=128)
    repository_max_nodes: int = Field(default=250_000,ge=10,le=2_000_000)
    repository_max_viewport_bytes: int = Field(default=64*1024*1024,ge=128,le=512*1024*1024)
    repository_max_simplification_steps: int = Field(default=1_000_000,ge=1,le=10_000_000)
    import_max_bytes: int = Field(default=512 * 1024 * 1024, ge=1024)
    import_disk_quota_bytes: int = Field(default=4 * 1024**3, ge=1024)
    import_chunk_bytes: int = Field(default=64 * 1024, ge=1024, le=1024 * 1024)
    import_batch_size: int = Field(default=500, ge=1, le=2000)
    import_batch_bytes: int = Field(default=4 * 1024 * 1024, ge=1024)
    import_max_feature_bytes: int = Field(default=8 * 1024 * 1024, ge=128)
    import_max_metadata_bytes: int = Field(default=1024 * 1024, ge=128)
    import_max_feature_vertices: int = Field(default=100_000, ge=1)
    import_max_vertices: int = Field(default=50_000_000, ge=1)
    import_max_features: int = Field(default=2_000_000, ge=1)
    import_max_depth: int = Field(default=64, ge=4, le=128)
    import_max_feature_nodes: int = Field(default=500_000, ge=10)
    import_max_categories: int = Field(default=10_000, ge=1)
    import_max_category_chars: int = Field(default=1024, ge=1, le=4096)
    import_max_uploads: int = Field(default=2, ge=1, le=16)
    import_max_running: int = Field(default=2, ge=1, le=16)
    import_max_pending: int = Field(default=10, ge=1)
    import_upload_timeout_seconds: float = Field(default=1800, gt=0)
    import_upload_lease_seconds: float = Field(default=60, ge=1)
    import_lease_seconds: float = Field(default=30, ge=1)
    import_stall_seconds: float = Field(default=30, gt=0)
    import_job_timeout_seconds: float = Field(default=3600, gt=0)
    import_worker_memory_bytes: int = Field(default=512 * 1024 * 1024, ge=1024)
    import_warning_samples: int = Field(default=50, ge=0, le=1000)

    @property
    def import_directory(self) -> Path:
        # Isolated tests automatically get isolated upload directories too.
        return self.database_path.parent / "imports"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )

    @field_validator("database_path")
    @classmethod
    def resolve_database_path(cls, value: Path) -> Path:
        value = value.expanduser()
        if not value.is_absolute():
            value = BACKEND_DIR / value
        return value.resolve()
