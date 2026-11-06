from copy import deepcopy

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError

from app.db.models import Category, Feature
from app.services.datasets import DatasetService
from app.services.errors import NotFoundError, RevisionConflictError

RING = [[37, 39, 10], [38, 39, 11], [38, 40, 12], [37, 39, 10]]


def feature(geometry=None, **extra):
    return {"type": "Feature", "properties": {"name": "Alan"}, "geometry": geometry, **extra}


def polygon(**extra):
    return feature({"type": "Polygon", "coordinates": [deepcopy(RING)]}, **extra)


def test_empty_dataset_contract(service):
    dataset = service.create_dataset()
    assert dataset.id != dataset.generation_id
    assert service.summary(dataset.id).model_dump(by_alias=True) == {
        "name": "Adsız çalışma.geojson", "count": 0, "vertices": 0, "bounds": None, "sourceBytes": 0, "revision": 0,
    }
    assert dataset.next_ordinal == 0 and dataset.status == "draft"
    assert service.list_features(dataset.id).model_dump() == {"items": [], "total": 0}


@pytest.mark.parametrize("geometry", [
    {"type": "Polygon", "coordinates": [RING]},
    {"type": "Point", "coordinates": [37, 39, 123]},
    {"type": "MultiPoint", "coordinates": [[37, 39], [38, 40]]},
    {"type": "LineString", "coordinates": [[37, 39, 5], [38, 40, 7]]},
    {"type": "MultiLineString", "coordinates": [[[37, 39], [38, 40]], [[39, 41], [40, 42]]]},
    {"type": "MultiPolygon", "coordinates": [[RING], [RING]]},
    {"type": "GeometryCollection", "geometries": [
        {"type": "Point", "coordinates": [37, 39, 123]},
        {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "coordinates": [RING]}]},
    ]},
    None,
])
def test_all_geometry_types_roundtrip_across_sessions(service, session, migrated_database, geometry):
    dataset = service.create_dataset()
    original = feature(deepcopy(geometry), id="external-id", custom={"nested": [None, True, 1.5]})
    result = service.add_feature(dataset.id, original)
    dataset_id, internal_id = dataset.id, result.id
    assert internal_id == f"{dataset.generation_id}:0"
    session.commit()
    with migrated_database.sessions() as reader:
        loaded = DatasetService(reader).get_feature(dataset_id, internal_id)
        assert loaded.feature == original
        assert loaded.summary.model_dump(by_alias=True)["geometryType"] == (geometry["type"] if geometry else "Geometri yok")


def test_properties_z_external_ids_and_foreign_members(service):
    dataset = service.create_dataset(source_bytes=1234)
    original = polygon(id=22, bbox=[37, 39, 38, 40], custom={"source": "Şırnak 🌍"})
    original["properties"] = {
        "name": "Park", "nested": {"bool": True, "null": None, "array": [1, "1", {"a": 2}]},
        "ana_kategori": "Arazi", "alt_kategori": "Park", "kategori": "Eski ad", "unknown": "koru",
    }
    result = service.add_feature(dataset.id, original)
    original["properties"]["nested"]["array"].append("caller mutation")
    loaded = service.get_feature(dataset.id, result.id)
    assert loaded.feature == result.record.feature
    assert loaded.feature["geometry"]["coordinates"][0] == RING
    assert loaded.feature["properties"]["kategori"] == "Eski ad"
    assert loaded.feature["bbox"] == [37, 39, 38, 40]
    assert loaded.summary.vertices == 4
    assert result.dataset.bounds == [37, 39, 38, 40]
    assert result.dataset.source_bytes == 1234
    loaded.feature["properties"]["name"] = "local only"
    assert service.get_feature(dataset.id, result.id).feature["properties"]["name"] == "Park"


@pytest.mark.parametrize("external_id", [7, "7"])
def test_duplicate_external_ids_are_not_storage_keys(service, external_id):
    dataset = service.create_dataset()
    a = service.add_feature(dataset.id, polygon(id=external_id))
    b = service.add_feature(dataset.id, polygon(id=external_id))
    assert a.id != b.id
    assert type(a.record.feature["id"]) is type(external_id)
    assert service.list_features(dataset.id).total == 2


def test_null_properties_and_null_geometry_are_not_deletion(service):
    dataset = service.create_dataset()
    result = service.add_feature(dataset.id, feature(properties=None))
    assert result.record.feature["properties"] is None
    assert result.dataset.count == 1 and result.dataset.vertices == 0 and result.dataset.bounds is None


def test_update_delete_restore_ordinals_and_revision(service, session):
    dataset = service.create_dataset()
    a = service.add_feature(dataset.id, polygon(id=5), expected_revision=0)
    b = service.add_feature(dataset.id, feature({"type": "Point", "coordinates": [10, 20]}), expected_revision=1)
    changed = deepcopy(a.record.feature)
    changed["geometry"]["coordinates"][0][1][0] = 39
    changed["properties"]["name"] = "Yeni"
    updated = service.update_feature(dataset.id, a.id, changed, expected_revision=2)
    assert updated.id == a.id and updated.dataset.revision == 3
    assert updated.dataset.count == 2 and updated.dataset.vertices == 5
    assert updated.dataset.bounds == [10, 20, 39, 40]
    deleted = service.delete_feature(dataset.id, a.id, expected_revision=3)
    assert deleted.record is None and deleted.dataset.revision == 4
    assert deleted.dataset.count == 1 and deleted.dataset.vertices == 1 and deleted.dataset.bounds == [10, 20, 10, 20]
    with pytest.raises(NotFoundError):
        service.get_feature(dataset.id, a.id)
    tombstone = session.scalar(select(Feature).where(Feature.dataset_id == dataset.id, Feature.ordinal == 0))
    database_id = tombstone.id
    assert tombstone.is_deleted
    c = service.add_feature(dataset.id, feature())
    assert c.id.endswith(":2")
    restored = service.restore_feature(dataset.id, a.id, updated.record.feature)
    assert restored.id == a.id and restored.dataset.revision == 6
    assert tombstone.id == database_id and not tombstone.is_deleted
    assert [item.id for item in service.list_features(dataset.id).items] == [a.id, b.id, c.id]
    assert service.get_dataset(dataset.id).next_ordinal == 3


def test_geometry_update_removes_only_stale_bbox(service):
    dataset = service.create_dataset()
    original = feature({"type": "GeometryCollection", "bbox": [0, 0, 1, 1], "extra": "keep", "geometries": [
        {"type": "Point", "coordinates": [37, 39, 10], "bbox": [0, 0, 1, 1], "custom": True},
    ]}, bbox=[0, 0, 1, 1], foreign_member={"keep": True})
    added = service.add_feature(dataset.id, original)
    changed = deepcopy(original)
    changed["geometry"]["geometries"][0]["coordinates"][0] = 38
    updated = service.update_feature(dataset.id, added.id, changed).record.feature
    assert "bbox" not in updated and "bbox" not in updated["geometry"]
    assert "bbox" not in updated["geometry"]["geometries"][0]
    assert updated["geometry"]["extra"] == "keep" and updated["foreign_member"] == {"keep": True}
    assert updated["geometry"]["geometries"][0]["custom"] is True


def test_revision_conflicts_invalid_updates_and_foreign_generation(service):
    dataset = service.create_dataset()
    other = service.create_dataset()
    record = service.add_feature(dataset.id, polygon())
    with pytest.raises(RevisionConflictError):
        service.delete_feature(dataset.id, record.id, expected_revision=0)
    with pytest.raises(ValueError):
        service.delete_feature(other.id, record.id)
    with pytest.raises(ValueError):
        service.update_feature(dataset.id, record.id, {"type": "Feature", "geometry": False, "properties": {}})
    with pytest.raises(NotFoundError):
        service.restore_feature(dataset.id, f"{dataset.generation_id}:99", polygon())
    assert service.summary(dataset.id).revision == 1
    assert service.summary(other.id).revision == 0
    assert service.get_feature(dataset.id, record.id).feature == polygon()


def test_summary_pages_search_and_tombstones(service, session):
    dataset = service.create_dataset()
    ids = []
    for name in ["IĞDIR", "İSTANBUL", "Üsküdar", "Park"]:
        ids.append(service.add_feature(dataset.id, feature(properties={"name": name})).id)
    service.delete_feature(dataset.id, ids[0])
    statements = []
    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)
    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        page = service.list_features(dataset.id, offset=1, limit=1)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert page.total == 3 and [item.id for item in page.items] == [ids[2]]
    assert all("feature_json" not in statement for statement in statements)
    assert service.list_features(dataset.id, search="istanbul").items[0].id == ids[1]
    assert service.list_features(dataset.id, search="Geometri yok").total == 3
    assert service.list_features(dataset.id, offset=99).items == []
    assert set(page.items[0].model_dump(by_alias=True)) == {"id", "label", "geometryType", "vertices", "bounds"}


@pytest.mark.parametrize("offset,limit", [(-1, 10), (0, 0), (0, 101), (True, 1)])
def test_invalid_pagination(service, offset, limit):
    dataset = service.create_dataset()
    with pytest.raises(ValueError):
        service.list_features(dataset.id, offset=offset, limit=limit)


def test_database_failure_rolls_back_feature_categories_revision_and_ordinal(service, session):
    dataset = service.create_dataset(name="fault")
    session.execute(text("""CREATE TRIGGER reject_summary BEFORE UPDATE OF count ON datasets
        WHEN NEW.name = 'fault' AND NEW.count > OLD.count
        BEGIN SELECT RAISE(ABORT, 'test failure after feature and catalog writes'); END"""))
    session.commit()
    bad = polygon(properties={"name": "Reddedilecek", "ana_kategori": "Yeni", "alt_kategori": "Alt"})
    with pytest.raises(IntegrityError):
        service.add_feature(dataset.id, bad)
    assert service.summary(dataset.id).revision == 0
    assert service.summary(dataset.id).count == 0
    assert service.get_dataset(dataset.id).next_ordinal == 0
    assert service.categories(dataset.id) == []
    assert session.scalar(select(func.count(Feature.id))) == 0
    assert session.scalar(select(func.count(Category.id))) == 0
    session.execute(text("DROP TRIGGER reject_summary"))
    assert service.add_feature(dataset.id, polygon()).id.endswith(":0")


def test_service_never_commits_callers_transaction(service, session, migrated_database):
    dataset = service.create_dataset()
    dataset_id = dataset.id
    session.commit()
    service.add_feature(dataset_id, polygon())
    session.rollback()
    with migrated_database.sessions() as reader:
        summary = DatasetService(reader).summary(dataset_id)
        assert summary.count == 0 and summary.revision == 0
        assert DatasetService(reader).get_dataset(dataset_id).next_ordinal == 0


def test_structural_not_topological_validation(service):
    dataset = service.create_dataset()
    bow_tie = feature({"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]})
    assert service.add_feature(dataset.id, bow_tie).record.feature == bow_tie


def test_deleting_last_geometry_resets_bounds_and_repeated_delete_is_rejected(service):
    dataset = service.create_dataset()
    added = service.add_feature(dataset.id, polygon())
    deleted = service.delete_feature(dataset.id, added.id)
    assert deleted.dataset.count == 0 and deleted.dataset.vertices == 0 and deleted.dataset.bounds is None
    with pytest.raises(NotFoundError):
        service.delete_feature(dataset.id, added.id)
    assert service.summary(dataset.id).revision == 2


def test_snapshot_dataset_cannot_be_mutated(service, session):
    dataset = service.create_dataset()
    dataset.status = "snapshot"
    session.flush()
    with pytest.raises(ValueError):
        service.add_feature(dataset.id, polygon())
    assert service.summary(dataset.id).revision == 0
