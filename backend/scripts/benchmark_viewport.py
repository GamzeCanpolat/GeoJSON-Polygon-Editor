"""Temporary SQLite viewport benchmark with exact reference-query checks.

No user database is opened. Each run builds a 0002 fixture and measures 0003's
backfill, then times the actual SpatialService count/decode/DTO path.
"""
import argparse
import json
import math
import os
from pathlib import Path
import statistics
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import command
from alembic.config import Config
from sqlalchemy import insert, text

from app.core.config import BACKEND_DIR, Settings
from app.db.models import Dataset, Feature
from app.db.session import Database
from app.services.spatial import COUNT_SQL, RECORDS_SQL, SpatialService

REFERENCE_FROM = """FROM features f WHERE f.dataset_id=:dataset_id AND f.is_deleted=0 AND f.bounds IS NOT NULL
    AND json_extract(f.bounds,'$[0]')<=:max_x AND json_extract(f.bounds,'$[2]')>=:min_x
    AND json_extract(f.bounds,'$[1]')<=:max_y AND json_extract(f.bounds,'$[3]')>=:min_y"""


def seed(database, count):
    rows_count = math.ceil(count / 1000)
    with database.sessions.begin() as session:
        primary = Dataset(name="viewport-synthetic.geojson", count=count, vertices=count * 5, next_ordinal=count)
        noise = Dataset(name="other-dataset.geojson", count=min(count, 15_000), vertices=min(count, 15_000) * 5,
                        next_ordinal=min(count, 15_000))
        session.add_all([primary, noise])
        session.flush()
        identifiers = primary.id, noise.id
    for dataset_id, amount in ((identifiers[0], count), (identifiers[1], min(count, 15_000))):
        for offset in range(0, amount, 1000):
            batch = []
            for ordinal in range(offset, min(offset + 1000, amount)):
                x = -175 + (ordinal % 1000) * .35
                y = -80 + (ordinal // 1000) * (160 / rows_count)
                width, height = .07, (160 / rows_count) * .2
                coordinates = [[x, y, 10], [x + width, y, 11], [x + width, y + height, 12],
                               [x, y + height, 13], [x, y, 10]]
                feature = {"type": "Feature", "id": ordinal % 29, "properties": {"name": f"Alan {ordinal}", "keep": {"typed": [True, None, 1.5]}},
                           "geometry": {"type": "Polygon", "coordinates": [coordinates]}}
                batch.append(dict(dataset_id=dataset_id, ordinal=ordinal, feature_json=feature, label=f"Alan {ordinal}",
                                  geometry_type="Polygon", vertices=5, bounds=[x, y, x + width, y + height], is_deleted=False))
            with database.sessions.begin() as session:
                session.execute(insert(Feature.__table__), batch)
    return identifiers[0]


def median_ms(samples):
    return round(statistics.median(samples) * 1000, 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", type=int, default=150_000)
    parser.add_argument("--iterations", type=int, default=15)
    parser.add_argument("--report", type=Path, default=BACKEND_DIR / "var/benchmarks/viewport.json")
    args = parser.parse_args()
    if not 1 <= args.features <= 1_000_000 or not 1 <= args.iterations <= 100:
        parser.error("features must be 1..1000000 and iterations 1..100")
    process = psutil.Process()
    baseline = process.memory_info().rss
    peak = [baseline]
    stop = Event()
    def monitor():
        while not stop.wait(.025):
            peak[0] = max(peak[0], process.memory_info().rss)
    watcher = Thread(target=monitor, daemon=True)
    watcher.start()
    previous_path = os.environ.get("GEOJSON_DATABASE_PATH")
    try:
        with TemporaryDirectory(prefix="geojson-viewport-benchmark-") as directory:
            db_path = Path(directory) / "viewport.db"
            os.environ["GEOJSON_DATABASE_PATH"] = str(db_path)
            settings = Settings(_env_file=None, database_path=db_path)
            config = Config(str(BACKEND_DIR / "alembic.ini"))
            command.upgrade(config, "0002_import_jobs")
            database = Database(settings)
            try:
                started = time.perf_counter()
                dataset_id = seed(database, args.features)
                fixture_seconds = time.perf_counter() - started
                started = time.perf_counter()
                command.upgrade(config, "0003_spatial_index")
                backfill_seconds = time.perf_counter() - started
                with database.sessions() as session:
                    index_rows = session.execute(text("SELECT count(*) FROM feature_rtree")).scalar_one()
                    assert index_rows == args.features + min(args.features, 15_000)
                    assert session.execute(text("SELECT rtreecheck('feature_rtree')")).scalar_one() == "ok"
                    cases = [
                        ("small", [-20, -10, -19, -9]),
                        ("city", [28, 40, 30, 42]),
                        ("regional", [20, 20, 60, 50]),
                        ("world", [-180, -90, 180, 90]),
                        ("empty", [-180, 85, 180, 90]),
                    ]
                    measurements = []
                    service = SpatialService(session)
                    for name, bounds in cases:
                        parameters = service.parameters(dataset_id, bounds, 2500)
                        reference_count = session.execute(text("SELECT count(*) " + REFERENCE_FROM), parameters).scalar_one()
                        reference_ordinals = session.execute(text("SELECT f.ordinal " + REFERENCE_FROM + " ORDER BY f.ordinal LIMIT :limit"), parameters).scalars().all()
                        generation = service.session.get(Dataset, dataset_id).generation_id
                        expected_ids = [f"{generation}:{ordinal}" for ordinal in reference_ordinals]
                        result = service.query(dataset_id, bounds, .0001, 2500)
                        assert result.matched == reference_count
                        assert [record.summary.id for record in result.records] == expected_ids
                        assert result.limited == (reference_count > 2500)
                        query_plan = [row[3] for row in session.execute(text("EXPLAIN QUERY PLAN " + RECORDS_SQL), parameters)]
                        assert any("VIRTUAL TABLE INDEX" in line for line in query_plan), query_plan
                        assert any("INTEGER PRIMARY KEY" in line for line in query_plan), query_plan
                        actual_times, reference_times = [], []
                        for _ in range(args.iterations):
                            started = time.perf_counter()
                            result = service.query(dataset_id, bounds, .0001, 2500)
                            actual_times.append(time.perf_counter() - started)
                        for _ in range(3):
                            started = time.perf_counter()
                            session.execute(text("SELECT count(*) " + REFERENCE_FROM), parameters).scalar_one()
                            reference_times.append(time.perf_counter() - started)
                        measurements.append({"name": name, "bounds": bounds, "matched": reference_count,
                                             "returned": len(result.records), "limited": result.limited,
                                             "serviceMedianMs": median_ms(actual_times),
                                             "serviceMaxMs": round(max(actual_times) * 1000, 3),
                                             "referenceCountMedianMs": median_ms(reference_times),
                                             "queryPlan": query_plan, "matchesReference": True})
                report = {"datasetFeatures": args.features, "otherDatasetFeatures": min(args.features, 15_000),
                          "indexRows": index_rows, "fixtureSeconds": round(fixture_seconds, 3),
                          "migrationBackfillSeconds": round(backfill_seconds, 3), "iterations": args.iterations,
                          "baselineRssMiB": round(baseline / 1024**2, 3), "peakRssMiB": round(peak[0] / 1024**2, 3),
                          "measurements": measurements, "allReferenceChecksMatch": True,
                          "environment": "macOS; temporary SQLite; warm SpatialService count + JSON decode + DTO; synthetic small Polygon/Z grid; no HTTP network time"}
                args.report.parent.mkdir(parents=True, exist_ok=True)
                args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
                print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
            finally:
                database.dispose()
    finally:
        if previous_path is None:
            os.environ.pop("GEOJSON_DATABASE_PATH", None)
        else:
            os.environ["GEOJSON_DATABASE_PATH"] = previous_path
        stop.set()
        watcher.join(2)


if __name__ == "__main__":
    main()
