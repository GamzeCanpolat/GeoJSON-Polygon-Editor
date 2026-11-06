"""Display-only simplification matching the current local TypeScript adapter.

Coordinates selected for the preview keep their complete tuples, including Z.
Never pass this result to a persistence/export operation.
"""
from copy import deepcopy

DEFAULT_MAX_SIMPLIFICATION_STEPS = 1_000_000


class _SimplificationStopped(Exception):
    """Unwind the complete root geometry instead of returning partial rings."""


class SimplificationBudget:
    """Bound distance evaluations across all geometries in one viewport query."""

    def __init__(self, max_steps: int = DEFAULT_MAX_SIMPLIFICATION_STEPS):
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps < 0:
            raise ValueError("Sadeleştirme adım sınırı negatif olmayan bir tamsayı olmalı.")
        self.remaining_steps = max_steps

    def consume(self) -> None:
        if self.remaining_steps == 0:
            raise _SimplificationStopped
        self.remaining_steps -= 1


def _line(points: list, tolerance: float, *, budget: SimplificationBudget, ring: bool = False) -> list:
    if len(points) < 12 or tolerance <= 0:
        return deepcopy(points)
    squared = tolerance * tolerance
    keep = bytearray(len(points))
    keep[0] = keep[-1] = 1
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        a, b = points[first], points[last]
        dx, dy = b[0] - a[0], b[1] - a[1]
        maximum, index = squared, 0
        for candidate in range(first + 1, last):
            budget.consume()
            point = points[candidate]
            fraction = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy))) if dx or dy else 0
            distance = (point[0] - a[0] - dx * fraction) ** 2 + (point[1] - a[1] - dy * fraction) ** 2
            if distance > maximum:
                maximum, index = distance, candidate
        if index:
            keep[index] = 1
            stack.extend(((first, index), (index, last)))
    selected = [deepcopy(point) for index, point in enumerate(points) if keep[index]]
    return selected if len(selected) >= (4 if ring else 2) else deepcopy(points)


def _simplify_geometry(geometry: dict | None, tolerance: float, budget: SimplificationBudget) -> dict | None:
    if geometry is None:
        return None
    result = deepcopy(geometry)
    kind = geometry["type"]
    if kind == "LineString":
        result["coordinates"] = _line(geometry["coordinates"], tolerance, budget=budget)
    elif kind == "MultiLineString":
        result["coordinates"] = [_line(line, tolerance, budget=budget) for line in geometry["coordinates"]]
    elif kind == "Polygon":
        result["coordinates"] = [_line(ring, tolerance, budget=budget, ring=True) for ring in geometry["coordinates"]]
    elif kind == "MultiPolygon":
        result["coordinates"] = [[_line(ring, tolerance, budget=budget, ring=True) for ring in polygon] for polygon in geometry["coordinates"]]
    elif kind == "GeometryCollection":
        result["geometries"] = [_simplify_geometry(child, tolerance, budget) for child in geometry["geometries"]]
    return result


def simplify_geometry(geometry: dict | None, tolerance: float, *, budget: SimplificationBudget | None = None,
                      max_simplification_steps: int = DEFAULT_MAX_SIMPLIFICATION_STEPS) -> dict | None:
    """Return a preview, or the entire original geometry when work is exhausted.

    Douglas-Peucker can require quadratic work. Only distance evaluations spend
    this budget; copying the original remains linear in its already capped size.
    A shared budget bounds the whole viewport, including collection components.
    Direct callers receive the same finite default budget automatically.
    """
    shared = budget if budget is not None else SimplificationBudget(max_simplification_steps)
    if shared.remaining_steps == 0 or tolerance <= 0:
        return deepcopy(geometry)
    try:
        return _simplify_geometry(geometry, tolerance, shared)
    except _SimplificationStopped:
        return deepcopy(geometry)
