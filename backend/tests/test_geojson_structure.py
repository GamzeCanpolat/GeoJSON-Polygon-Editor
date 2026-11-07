from copy import deepcopy

import pytest

from app.domain.geojson import prepare_feature


@pytest.mark.parametrize("geometry", [
    {"type": "Point", "coordinates": [181, 39]},
    {"type": "Point", "coordinates": [True, 39]},
    {"type": "LineString", "coordinates": [[37, 39]]},
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
    {"type": "Unsupported", "coordinates": []},
    {"type": "Point", "coordinates": [37, float("nan")]},
])
def test_invalid_structure_leaves_existing_feature_unchanged(service, geometry):
    dataset = service.create_dataset()
    original = {"type": "Feature", "properties": {}, "geometry": None}
    record = service.add_feature(dataset.id, original)
    with pytest.raises(ValueError):
        service.update_feature(dataset.id, record.id, {**original, "geometry": geometry})
    assert service.summary(dataset.id).revision == 1
    assert service.get_feature(dataset.id, record.id).feature == original


def test_geometry_foreign_members_and_input_are_preserved():
    original = {"type": "Feature", "properties": {"values": [1, "1", None, False]}, "geometry": {
        "type": "Point", "coordinates": [37, 39, 12], "custom": {"keep": True},
    }, "extra": {"keep": True}}
    before = deepcopy(original)
    assert prepare_feature(original) == before
    assert original == before


@pytest.mark.parametrize("properties", [{"x": float("inf")}, {"x": (1, 2)}, {1: "not a JSON key"}])
def test_non_json_properties_are_rejected_without_coercion(properties):
    with pytest.raises(ValueError):
        prepare_feature({"type": "Feature", "properties": properties, "geometry": None})
