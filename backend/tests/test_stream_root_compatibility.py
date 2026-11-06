"""The HTTP import path accepts the same root envelopes as local open()."""
import io
import json
import tracemalloc

from fastapi.testclient import TestClient
import pytest

from app.domain.streaming_geojson import StreamFormatError, stream_collection
from app.services.jobs import JobService
from app.workers.import_worker import ProgressReader, run_import


GEOMETRIES = [
    {"type": "Point", "coordinates": [29, 41, 17]},
    {"type": "MultiPoint", "coordinates": [[29, 41, 17], [30, 42, 18]]},
    {"type": "LineString", "coordinates": [[29, 41, 17], [30, 42, 18]]},
    {"type": "MultiLineString", "coordinates": [[[29, 41], [30, 42]]]},
    {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 0]]]},
    {"type": "MultiPolygon", "coordinates": [[[[0, 0], [2, 0], [2, 2], [0, 0]]]]},
    {"type": "GeometryCollection", "geometries": [{"type": "Point", "coordinates": [29, 41, 17]}]},
]


def parse(payload, settings):
    return list(stream_collection(io.BytesIO(json.dumps(payload, ensure_ascii=False).encode()), settings))


@pytest.mark.parametrize("geometry", GEOMETRIES)
def test_bare_geometry_root_is_wrapped_without_changing_coordinates(settings, geometry):
    root = {key: value for key, value in geometry.items() if key != "type"}
    root.update({"foreign": {"keep": [True, None, "İğdır"]}, "type": geometry["type"]})
    events = parse(root, settings)
    assert events[0][0] == "feature"
    assert events[0][1] == {"type": "Feature", "properties": {}, "geometry": root}
    assert events[1] == ("metadata", {"type": "FeatureCollection"}, 0)


@pytest.mark.parametrize("geometry", [GEOMETRIES[0], None])
def test_single_feature_preserves_foreign_fields_and_type_last(settings, geometry):
    root = {"id": 9007199254740993, "properties": {"unknown": [None, False, {"x.y": "Ş"}]},
            "geometry": geometry, "category_catalog": "foreign Feature field", "features": [], "type": "Feature"}
    events = parse(root, settings)
    assert [event[0] for event in events] == ["feature", "metadata"]
    assert events[0][1] == root
    assert "category_catalog" not in events[1][1]


def test_single_feature_uses_feature_budget_instead_of_collection_metadata_budget(settings):
    settings.import_max_metadata_bytes = 128
    root = {"properties": {"padding": "x" * 2048}, "geometry": None, "type": "Feature"}
    assert parse(root, settings)[0][1] == root


def test_single_feature_preserves_non_collection_foreign_features_member(settings):
    root = {"features": {"foreign": [1, 2, 3]}, "geometry": None, "properties": {}, "type": "Feature"}
    assert parse(root, settings)[0][1] == root


@pytest.mark.parametrize("root_kind", ["Feature", "Point"])
@pytest.mark.parametrize("type_first", [True, False])
@pytest.mark.parametrize("foreign_features", [[1, {"unknown": [True, None]}], "foreign scalar", 42])
def test_foreign_features_is_preserved_for_single_roots(settings, root_kind, type_first, foreign_features):
    fields = [("type", root_kind), ("features", foreign_features)]
    fields += ([("properties", {}), ("geometry", None)] if root_kind == "Feature"
               else [("coordinates", [29, 41, 120])])
    if not type_first:
        fields = fields[1:] + fields[:1]
    root = dict(fields)
    feature = parse(root, settings)[0][1]
    assert (feature if root_kind == "Feature" else feature["geometry"]) == root


@pytest.mark.parametrize("type_first", [False, True])
def test_collection_metadata_budget_remains_strict_regardless_of_type_order(settings, type_first):
    settings.import_max_metadata_bytes = 128
    fields = [("type", "FeatureCollection"), ("foreign", "x" * 256), ("features", [])]
    if not type_first:
        fields.reverse()
    with pytest.raises(StreamFormatError):
        parse(dict(fields), settings)


def test_single_root_aggregate_feature_byte_budget_cannot_be_split_across_fields(settings):
    settings.import_max_feature_bytes = 512
    root = {"type": "Feature", "properties": {"a": "x" * 250}, "foreign": "y" * 250, "geometry": None}
    with pytest.raises(StreamFormatError):
        parse(root, settings)


def test_single_root_aggregate_node_budget_cannot_be_split_across_fields(settings):
    settings.import_max_feature_nodes = 20
    root = {"type": "Feature", "properties": {"items": [True] * 10}, "geometry": None, "extra": [False] * 5}
    with pytest.raises(StreamFormatError):
        parse(root, settings)


def test_single_root_depth_budget_includes_its_root_object(settings):
    settings.import_max_depth = 4
    root = {"type": "Feature", "properties": {}, "geometry": None, "extra": {"a": {"b": {"c": {"d": 1}}}}}
    with pytest.raises(StreamFormatError):
        parse(root, settings)


@pytest.mark.parametrize("payload", [
    {"features": [{"type": "Feature", "properties": {}, "geometry": None}], "type": "wrong"},
    {"type": "FeatureCollection"},
    {"type": "FeatureCollection", "features": {}},
    {"type": "Unrecognized", "coordinates": [0, 0]},
])
def test_non_geojson_and_ambiguous_collection_roots_still_fail(settings, payload):
    with pytest.raises(StreamFormatError):
        parse(payload, settings)


def test_collection_is_still_yielded_before_the_entire_file_is_read(settings):
    settings.import_chunk_bytes = 1024
    feature = {"type": "Feature", "properties": {"padding": "x" * 2048}, "geometry": None}
    source = io.BytesIO(json.dumps({"features": [feature] * 20, "type": "FeatureCollection"}).encode())
    events = stream_collection(source, settings)
    assert next(events)[1] == feature
    assert source.tell() < len(source.getbuffer())
    remaining = list(events)
    assert sum(kind == "feature" for kind, _, _ in remaining) == 19
    assert remaining[-1][1] == {"type": "FeatureCollection"}


def test_type_last_collection_discriminator_is_memory_bounded_and_progress_monotonic(settings, tmp_path):
    settings.import_chunk_bytes = 1024
    path = tmp_path / "type-last.geojson"
    feature = {"type": "Feature", "properties": {"padding": "x" * 2048}, "geometry": None}
    raw = json.dumps(feature).encode()
    with path.open("wb") as output:
        output.write(b'{"features":[')
        for index in range(2000):
            if index:
                output.write(b",")
            output.write(raw)
        output.write(b'],"type":"FeatureCollection"}')
    pulses = []
    tracemalloc.start()
    try:
        with path.open("rb") as source:
            reader = ProgressReader(source, settings.import_chunk_bytes, pulses.append)
            count = sum(kind == "feature" for kind, _, _ in stream_collection(reader, settings))
            assert count == 2000
            assert reader.bytes_read == reader.tell() == path.stat().st_size
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert pulses == sorted(pulses) and all(0 <= amount <= path.stat().st_size for amount in pulses)
    assert peak < 2 * 1024 * 1024


def test_nonseekable_type_first_collection_remains_supported(settings):
    class Reader:
        def __init__(self, content):
            self.source = io.BytesIO(content)

        def read(self, size=-1):
            assert 0 <= size <= settings.import_chunk_bytes
            return self.source.read(size)

    source = Reader(b'{"type":"FeatureCollection","features":[]}')
    assert list(stream_collection(source, settings))[-1][1] == {"type": "FeatureCollection"}
    ambiguous = Reader(b'{"features":[],"type":"FeatureCollection"}')
    with pytest.raises(StreamFormatError, match="yeniden okunabilir"):
        list(stream_collection(ambiguous, settings))


@pytest.mark.parametrize("payload", [
    {"id": "outside-id", "properties": {"name": "İstanbul", "unknown": [None, True]},
     "geometry": GEOMETRIES[0], "foreign": {"preserve": True}, "category_catalog": "Feature metadata", "type": "Feature"},
    GEOMETRIES[-1],
    {"type": "Feature", "properties": None, "geometry": None},
    {"features": [1, {"anything": [None, True]}], "coordinates": [29, 41, 120], "type": "Point"},
    {"features": [1, {"anything": [None, True]}], "geometry": None, "properties": {}, "type": "Feature"},
])
def test_single_root_completes_existing_upload_worker_activation_and_export(
    application, migrated_database, settings, payload
):
    with TestClient(application) as api:
        workspace = api.post("/api/v1/workspaces").json()
        identifier = workspace["id"]
        raw = json.dumps(payload, ensure_ascii=False).encode()
        uploaded = api.post(f"/api/v1/workspaces/{identifier}/imports",
                            files={"file": ("single.geojson", raw, "application/geo+json")})
        assert uploaded.status_code == 202, uploaded.text
        job_id = uploaded.json()["id"]
        jobs = JobService(migrated_database, settings)
        claim = jobs.claim()
        assert claim and claim[0] == job_id
        run_import(settings, *claim)
        jobs.maintain()
        completed = api.get(f"/api/v1/jobs/{job_id}").json()
        assert completed["status"] == "completed", completed
        assert completed["processedFeatures"] == 1
        assert completed["processedBytes"] == completed["totalBytes"] == len(raw)
        assert api.get(f"/api/v1/workspaces/{identifier}").json() == workspace
        activated = api.post(f"/api/v1/jobs/{job_id}/activate")
        assert activated.status_code == 200, activated.text
        active = activated.json()
        assert active["generationId"] != workspace["generationId"]
        assert active["dataset"]["revision"] == 0 and active["dataset"]["count"] == 1
        expected = payload if payload["type"] == "Feature" else {"type": "Feature", "properties": {}, "geometry": payload}
        exported = api.get(f"/api/v1/workspaces/{identifier}/export").json()
        assert exported["features"] == [expected]
        assert exported["category_catalog"] == []
