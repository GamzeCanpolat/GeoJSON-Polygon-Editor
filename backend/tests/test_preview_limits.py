"""Deterministic CPU limits protect previews without changing stored GeoJSON."""
from copy import deepcopy

import pytest

from app.domain.preview import DEFAULT_MAX_SIMPLIFICATION_STEPS, SimplificationBudget, simplify_geometry
from app.services.spatial import SpatialService


def line(count=30, *, zigzag=False):
    return {"type": "LineString", "coordinates": [[index / 100, (index % 2) if zigzag else 0, 100 + index]
                                                 for index in range(count)], "foreign": {"keep": True}}


def test_zigzag_stops_at_exact_budget_and_returns_complete_original():
    original = line(500, zigzag=True)
    before = deepcopy(original)
    budget = SimplificationBudget(37)
    result = simplify_geometry(original, 0.000001, budget=budget)
    assert budget.remaining_steps == 0
    assert result == original == before
    assert result is not original
    result["coordinates"][0][2] = -1
    assert original == before


def test_budget_boundary_allows_completed_line_but_never_partial_line():
    original = line()
    # A collinear line requires exactly n-2 distance comparisons.
    assert simplify_geometry(original, .01, max_simplification_steps=28)["coordinates"] == [original["coordinates"][0], original["coordinates"][-1]]
    assert simplify_geometry(original, .01, max_simplification_steps=27) == original
    assert simplify_geometry(original, .01, max_simplification_steps=0) == original


def test_geometry_collection_uses_cumulative_budget_and_reverts_all_components():
    original = {"type": "GeometryCollection", "geometries": [line(), line(100, zigzag=True)], "foreign": {"keep": [None, True]}}
    before = deepcopy(original)
    budget = SimplificationBudget(29)
    result = simplify_geometry(original, .001, budget=budget)
    assert result == before == original
    # The first child was simplified before the second exhausted the budget.
    # Restoring the whole root prevents returning that partial preview.
    assert len(result["geometries"][0]["coordinates"]) == 30
    assert budget.remaining_steps == 0


def test_shared_budget_preserves_later_geometries_without_more_distance_work():
    budget = SimplificationBudget(15)
    original = line(12)
    assert len(simplify_geometry(original, .01, budget=budget)["coordinates"]) == 2
    assert budget.remaining_steps == 5
    assert simplify_geometry(original, .01, budget=budget) == original
    assert budget.remaining_steps == 0
    assert simplify_geometry(line(500, zigzag=True), .000001, budget=budget) == line(500, zigzag=True)
    assert budget.remaining_steps == 0


@pytest.mark.parametrize("maximum", [-1, True, 1.5, None])
def test_invalid_simplification_budget_is_rejected(maximum):
    with pytest.raises(ValueError):
        simplify_geometry(line(), .1, max_simplification_steps=maximum)


def test_direct_calls_default_to_finite_budget(monkeypatch):
    consumed = 0
    original_consume = SimplificationBudget.consume
    def consume(self):
        nonlocal consumed
        consumed += 1
        return original_consume(self)
    monkeypatch.setattr(SimplificationBudget, "consume", consume)
    # Adversarial alternating points force repeated splits instead of the
    # single pass required by a straight line.
    original = line(2500, zigzag=True)
    result = simplify_geometry(original, 0.000001)
    assert result == original
    assert consumed == DEFAULT_MAX_SIMPLIFICATION_STEPS + 1


def test_viewport_shares_one_budget_across_records(service, session):
    dataset = service.create_dataset("preview.geojson")
    original = {"type": "Feature", "properties": {"name": "Z line"}, "geometry": line(12)}
    first = service.add_feature(dataset.id, original)
    second = service.add_feature(dataset.id, original)
    session.flush()
    result = SpatialService(session).query(dataset.id, [-1, -1, 1, 1], .01, 10, max_simplification_steps=15)
    assert len(result.records[0].feature["geometry"]["coordinates"]) == 2
    assert result.records[1].feature == original
    assert service.get_feature(dataset.id, first.id).feature == original
    assert service.get_feature(dataset.id, second.id).feature == original
