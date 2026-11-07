import pytest

from app.domain.categories import category_key


@pytest.mark.parametrize("name,expected", [
    (" IĞDIR ", "ığdır"), ("İSTANBUL", "istanbul"), ("I", "ı"), ("İ", "i"),
    ("I\u0307", "i"), ("I\u0323\u0307", "ị\u0307"),
    ("S\u0327IRNAK", "şırnak"), ("\ufeffİzmir\u00a0", "izmir"),
    ("\u0085I\u0085", "\u0085ı\u0085"), ("ΟΣ", "ος"),
])
def test_frontend_compatible_normalization(name, expected):
    assert category_key(name) == expected


def test_main_subcategory_turkish_duplicates_and_revision(service):
    dataset = service.create_dataset()
    result = service.add_category(dataset.id, " IĞDIR ")
    assert result.dataset.revision == 1 and result.catalog[0].name == "IĞDIR"
    result = service.add_category(dataset.id, " İLÇE ", parent="ığdır")
    assert result.dataset.revision == 2
    assert result.catalog[0].subcategories == ["İLÇE"]
    with pytest.raises(ValueError):
        service.add_category(dataset.id, "ığdır")
    with pytest.raises(ValueError):
        service.add_category(dataset.id, "ilçe", parent="IĞDIR")
    with pytest.raises(ValueError):
        service.add_category(dataset.id, "Alt", parent="yok")
    assert service.summary(dataset.id).revision == 2


def test_unused_catalog_metadata_roundtrip_and_dataset_isolation(service, session, migrated_database):
    metadata = [{"name": "Arazi", "subcategories": ["Konut", "Park"]}, {"name": "Kullanılmıyor", "subcategories": []}]
    dataset = service.create_dataset(category_catalog=metadata)
    dataset_id = dataset.id
    assert dataset.revision == 0
    assert service.category_metadata(dataset_id) == {"category_catalog": metadata}
    other = service.create_dataset()
    assert service.categories(other.id) == []
    session.commit()
    from app.services.datasets import DatasetService
    with migrated_database.sessions() as reader:
        assert DatasetService(reader).category_metadata(dataset_id) == {"category_catalog": metadata}


def test_feature_assignment_keeps_properties_and_catalog_after_delete(service):
    dataset = service.create_dataset()
    original = {"type": "Feature", "geometry": None, "properties": {
        "ana_kategori": " Park ", "alt_kategori": " Çocuk ", "kategori": "legacy", "other": {"keep": True},
    }}
    record = service.add_feature(dataset.id, original)
    assert record.record.feature == original
    assert service.category_metadata(dataset.id) == {"category_catalog": [{"name": "Park", "subcategories": ["Çocuk"]}]}
    service.delete_feature(dataset.id, record.id)
    assert service.categories(dataset.id)[0].subcategories == ["Çocuk"]
    legacy = {"type": "Feature", "geometry": None, "properties": {"kategori": "Eski"}}
    assert service.add_feature(dataset.id, legacy).record.feature == legacy
    assert {group.name for group in service.categories(dataset.id)} == {"Park", "Eski"}


@pytest.mark.parametrize("bad", [None, {}, [{"name": "ok", "subcategories": []}, {"name": "bad", "subcategories": [""]}]])
def test_invalid_catalog_does_not_partially_change_data(service, bad):
    dataset = service.create_dataset()
    with pytest.raises(ValueError):
        service.import_category_catalog(dataset.id, bad)
    assert service.categories(dataset.id) == []
    assert service.summary(dataset.id).revision == 0


def test_catalog_merge_and_limits_match_frontend(service):
    dataset = service.create_dataset()
    result = service.import_category_catalog(dataset.id, [
        {"name": "İl", "subcategories": ["Merkez"]}, {"name": "il", "subcategories": ["merkez", "Diğer"]},
    ])
    assert len(result.catalog) == 1
    assert result.catalog[0].name == "İl"
    assert set(result.catalog[0].subcategories) == {"Merkez", "Diğer"}
    for bad in ["", " " * 4, "a" * 81, "🌍" * 41]:
        with pytest.raises(ValueError):
            service.add_category(dataset.id, bad)
    service.add_category(dataset.id, "🌍" * 40)
    # Existing metadata allows longer names, just as CategoryCatalog.import does.
    service.import_category_catalog(dataset.id, [{"name": "a" * 81, "subcategories": []}])


def test_explicit_null_catalog_is_not_treated_as_missing(service, session):
    from sqlalchemy import func, select
    from app.db.models import Dataset
    with pytest.raises(ValueError):
        service.create_dataset(category_catalog=None)
    assert session.scalar(select(func.count(Dataset.id))) == 0


def test_catalog_refreshes_already_loaded_relationships(service, session):
    from sqlalchemy import select
    from app.db.models import Category
    dataset = service.create_dataset()
    service.add_category(dataset.id, "Arazi")
    category = session.scalar(select(Category))
    assert category.subcategories == []
    service.add_category(dataset.id, "Park", parent="Arazi")
    assert service.categories(dataset.id)[0].subcategories == ["Park"]
