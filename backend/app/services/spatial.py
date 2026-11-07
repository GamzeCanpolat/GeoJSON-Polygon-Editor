"""SQLite R-Tree viewport lookup with exact double-precision refinement."""
import json
import math

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.domain.preview import DEFAULT_MAX_SIMPLIFICATION_STEPS, SimplificationBudget, simplify_geometry
from app.schemas.datasets import FeatureRecord, FeatureSummary, ViewportResult
from app.services.datasets import DatasetService

RTREE_TABLE_NAMES = frozenset({"feature_rtree", "feature_rtree_node", "feature_rtree_parent", "feature_rtree_rowid"})

# CROSS JOIN fixes the selective R-Tree as the outer scan. Without it SQLite can
# choose the dataset B-tree then repeatedly probe R-Tree for every dataset row.
# R-Tree bounds are float32/outward-rounded, so original JSON bounds must refine
# the candidate set to preserve RBush's exact bounding-box overlap behavior.
VIEWPORT_FROM_SQL = """
FROM feature_rtree AS r CROSS JOIN features AS f ON f.id = r.id
WHERE r.min_x <= :max_x AND r.max_x >= :min_x
  AND r.min_y <= :max_y AND r.max_y >= :min_y
  AND r.dataset_id = :dataset_id AND f.dataset_id = :dataset_id
  AND f.is_deleted = 0 AND f.bounds IS NOT NULL
  AND json_extract(f.bounds, '$[0]') <= :max_x
  AND json_extract(f.bounds, '$[2]') >= :min_x
  AND json_extract(f.bounds, '$[1]') <= :max_y
  AND json_extract(f.bounds, '$[3]') >= :min_y
"""
COUNT_SQL = "SELECT count(*) " + VIEWPORT_FROM_SQL
RECORDS_SQL = """SELECT f.ordinal, f.label, f.geometry_type, f.vertices, f.bounds, f.feature_json
""" + VIEWPORT_FROM_SQL + " ORDER BY f.ordinal LIMIT :limit"
BYTES_SQL = "SELECT coalesce(sum(byte_size),0) FROM (SELECT length(CAST(f.feature_json AS BLOB)) AS byte_size " + VIEWPORT_FROM_SQL + " ORDER BY f.ordinal LIMIT :limit)"


class SpatialLimitError(ValueError):
    """The selected original records exceed the configured preview IO budget."""


class SpatialService:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def parameters(dataset_id: str, bounds: list[float], limit: int = 2500) -> dict:
        if not isinstance(bounds, (list, tuple)) or len(bounds) != 4 or any(
            isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in bounds
        ):
            raise ValueError("bounds dört sonlu sayı içermeli.")
        min_x, min_y, max_x, max_y = bounds
        if not (-180 <= min_x <= max_x <= 180 and -90 <= min_y <= max_y <= 90):
            raise ValueError("WGS84 bounds sırası [minLon,minLat,maxLon,maxLat] olmalı.")
        if isinstance(limit, bool) or not isinstance(limit, int):
            raise ValueError("limit bir tamsayı olmalı.")
        return dict(dataset_id=dataset_id, min_x=min_x, min_y=min_y, max_x=max_x, max_y=max_y,
                    limit=min(3000, max(1, limit)))

    def query(self, dataset_id: str, bounds: list[float], tolerance: float, limit: int,
              *, max_source_bytes: int | None = 64 * 1024 * 1024,
              max_simplification_steps: int = DEFAULT_MAX_SIMPLIFICATION_STEPS) -> ViewportResult:
        if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or tolerance < 0:
            raise ValueError("tolerance negatif olmayan sonlu bir sayı olmalı.")
        budget = SimplificationBudget(max_simplification_steps)
        dataset = DatasetService(self.session).get_dataset(dataset_id)
        parameters = self.parameters(dataset_id, bounds, limit)
        matched = self.session.execute(text(COUNT_SQL), parameters).scalar_one()
        if max_source_bytes is not None:
            if isinstance(max_source_bytes, bool) or not isinstance(max_source_bytes, int) or max_source_bytes < 1:
                raise ValueError("Viewport kaynak boyut sınırı pozitif tamsayı olmalı.")
            source_bytes = self.session.execute(text(BYTES_SQL), parameters).scalar_one()
            if source_bytes > max_source_bytes:
                raise SpatialLimitError("Viewport kaynak verisi boyut sınırını aşıyor; limit veya görünür alanı küçültün.")
        rows = self.session.execute(text(RECORDS_SQL), parameters).mappings()
        records = []
        for row in rows:
            feature = json.loads(row["feature_json"])
            feature["geometry"] = simplify_geometry(feature["geometry"], tolerance, budget=budget)
            records.append(FeatureRecord(
                summary=FeatureSummary(id=f"{dataset.generation_id}:{row['ordinal']}", label=row["label"],
                                       geometry_type=row["geometry_type"], vertices=row["vertices"],
                                       bounds=json.loads(row["bounds"])),
                feature=feature,
            ))
        return ViewportResult(records=records, matched=matched, limited=matched > parameters["limit"])

    def rebuild(self) -> int:
        """Rebuild derived index transactionally; caller commits the transaction.

        This maintenance operation can take a write lock for its duration and is
        deliberately not exposed as an unauthenticated public HTTP endpoint.
        """
        self.session.execute(text("DELETE FROM feature_rtree"))
        self.session.execute(text("""INSERT INTO feature_rtree(id,min_x,max_x,min_y,max_y,dataset_id)
            SELECT id,json_extract(bounds,'$[0]'),json_extract(bounds,'$[2]'),
                   json_extract(bounds,'$[1]'),json_extract(bounds,'$[3]'),dataset_id
            FROM features WHERE is_deleted=0 AND bounds IS NOT NULL
              AND json_type(bounds)='array' AND json_array_length(bounds)=4"""))
        return self.session.execute(text("SELECT count(*) FROM feature_rtree")).scalar_one()
