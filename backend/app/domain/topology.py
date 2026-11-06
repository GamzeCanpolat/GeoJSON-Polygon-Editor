"""Read-only 2D topology diagnostics. No repair or source geometry rewriting."""
import json
import math
from pathlib import Path
import re

import shapely
from shapely.errors import GEOSException
from shapely.geometry import shape


def _xy(geometry: dict) -> dict:
    if geometry["type"] == "GeometryCollection":
        return {"type": "GeometryCollection", "geometries": [_xy(child) for child in geometry["geometries"] if child is not None]}
    def coordinates(value: list) -> list:
        if value and isinstance(value[0], (int, float)):
            return value[:2]
        return [coordinates(child) for child in value]
    return {"type": geometry["type"], "coordinates": coordinates(geometry["coordinates"])}


def _location(reason: str) -> list[float] | None:
    match = re.search(r"\[([^\]]+)\]", reason)
    if match is not None:
        try:
            values = [float(value) for value in match[1].split()[:2]]
            if len(values) == 2 and all(math.isfinite(value) for value in values):
                return values
        except ValueError:
            pass
    return None


def _diagnostic(reason: str, geometry_type: str) -> tuple[str, str]:
    if reason.startswith("Ring Self-intersection"):
        return "RING_SELF_INTERSECTION", "Polygon halkası kendi üzerinden geçiyor."
    if reason.startswith("Self-intersection"):
        if geometry_type == "MultiPolygon":
            return "MULTIPOLYGON_OVERLAP", "MultiPolygon parçaları geçersiz biçimde kesişiyor veya örtüşüyor."
        return "SELF_INTERSECTION", "Polygon kendi kendini kesiyor."
    reasons = {
        "Hole lies outside shell": ("HOLE_OUTSIDE_SHELL", "Polygon deliği dış sınırın dışına taşıyor."),
        "Holes are nested": ("NESTED_HOLES", "Polygon delikleri geçersiz biçimde iç içe geçiyor."),
        "Nested shells": ("NESTED_SHELLS", "Polygon dış halkaları geçersiz biçimde iç içe geçiyor."),
        "Disconnected interior": ("DISCONNECTED_INTERIOR", "Polygon iç alanı bağlantısız parçalara ayrılıyor."),
        "Too few points": ("DEGENERATE_GEOMETRY", "Geometri yeterli sayıda farklı nokta içermiyor."),
        "Invalid Coordinate": ("INVALID_COORDINATE", "Geometri geçersiz koordinat içeriyor."),
    }
    return next((value for prefix, value in reasons.items() if reason.startswith(prefix)),
                ("INVALID_TOPOLOGY", "Geometrinin topolojik yapısı geçersiz."))


def _polygon_hole_diagnostic(geometry: dict, path: str) -> dict | None:
    """Refine a generic GEOS intersection reason using temporary 2D rings."""
    if len(geometry["coordinates"]) < 2:
        return None
    coordinates = _xy(geometry)["coordinates"]
    shell = shape({"type": "Polygon", "coordinates": [coordinates[0]]})
    if not shapely.is_valid(shell):
        return None
    for index, ring in enumerate(coordinates[1:], 1):
        hole = shape({"type": "Polygon", "coordinates": [ring]})
        if not shapely.is_valid(hole):
            reason = str(shapely.is_valid_reason(hole))[:256]
            return {"code": "RING_SELF_INTERSECTION", "message": "Polygon deliğinin halkası kendi üzerinden geçiyor.",
                    "path": f"{path}.coordinates[{index}]", "reason": reason, "location": _location(reason)}
        if not shell.covers(hole):
            return {"code": "HOLE_OUTSIDE_SHELL", "message": "Polygon deliği dış sınırın dışına taşıyor.",
                    "path": f"{path}.coordinates[{index}]"}
    # Only the holes are tested here; this is a temporary diagnostic geometry,
    # never an attempted repair or replacement of the user's Polygon.
    if len(coordinates) > 2:
        holes = shape({"type": "MultiPolygon", "coordinates": [[ring] for ring in coordinates[1:]]})
        if not shapely.is_valid(holes):
            reason = str(shapely.is_valid_reason(holes))[:256]
            nested = reason.startswith("Nested shells")
            return {"code": "NESTED_HOLES" if nested else "HOLES_INTERSECTION",
                    "message": "Polygon delikleri geçersiz biçimde iç içe geçiyor." if nested else "Polygon delikleri birbirini geçersiz biçimde kesiyor veya örtüşüyor.",
                    "path": path, "reason": reason, "location": _location(reason)}
    return None


def validate_topology(item: dict, max_issues: int) -> dict:
    geometry = item["geometry"]
    errors, warnings = [], []
    truncated = False
    warnings_truncated = False

    def issue(code, message, path="geometry", reason=None, location=None):
        return {"code": code, "message": message, "path": path, "reason": reason, "location": location,
                "featureIndex": item["featureIndex"], "featureId": item["featureId"]}

    if item["hasZ"]:
        warnings.append(issue("EXTRA_DIMENSIONS_IGNORED", "Topolojik kontrol yalnızca boylam ve enlemi kullanır; Z ve ek koordinatlar değiştirilmedi."))

    def warn(value):
        nonlocal warnings_truncated
        if len(warnings) < max_issues:
            warnings.append(value)
        else:
            warnings_truncated = True

    def inspect(geometry, path):
        nonlocal truncated
        if len(errors) >= max_issues:
            truncated = True
            return
        if geometry is None:
            warn(issue("NULL_GEOMETRY", "Geometri null; Feature kaydı korunur ve topolojik kontrol atlanır.", path))
            return
        geometry_type = geometry["type"]
        before = len(errors)
        if geometry_type == "GeometryCollection":
            for index, child in enumerate(geometry["geometries"]):
                inspect(child, f"{path}.geometries[{index}]")
                if len(errors) >= max_issues:
                    truncated |= index < len(geometry["geometries"]) - 1
                    break
        elif geometry_type == "MultiPolygon":
            for index, polygon in enumerate(geometry["coordinates"]):
                inspect({"type": "Polygon", "coordinates": polygon}, f"{path}.coordinates[{index}]")
                if len(errors) >= max_issues:
                    truncated |= index < len(geometry["coordinates"]) - 1
                    break
        if len(errors) > before:
            return
        try:
            candidate = shape(_xy(geometry))
            if candidate.is_empty:
                errors.append(issue("EMPTY_GEOMETRY", "Geometri boş; kullanılabilir koordinat içermiyor.", path))
            elif not bool(shapely.is_valid(candidate)):
                reason = str(shapely.is_valid_reason(candidate))[:256]
                code, message = _diagnostic(reason, geometry_type)
                refined = _polygon_hole_diagnostic(geometry, path) if geometry_type == "Polygon" and "intersection" in reason else None
                if refined:
                    refined.setdefault("reason", reason)
                    refined.setdefault("location", _location(reason))
                errors.append(issue(**refined) if refined else issue(code, message, path, reason=reason, location=_location(reason)))
        except (GEOSException, ValueError, TypeError, IndexError) as error:
            # GEOS construction failures are geometry diagnostics, not HTTP 500.
            errors.append(issue("GEOMETRY_CONSTRUCTION_FAILED", "Geometri topolojik kontrol için oluşturulamadı.", path,
                                reason=str(error)[:256]))

    inspect(geometry, "geometry")
    if truncated or warnings_truncated:
        warnings.append(issue("ISSUE_LIMIT_REACHED", f"Feature başına {max_issues} hata/uyarı rapor sınırına ulaşıldı; başka bulgular olabilir."))
    valid = not errors
    return {"valid": valid, "geometryType": geometry["type"] if geometry is not None else None,
            "errors": errors, "warnings": warnings,
            "message": errors[0]["message"] if errors else ("Geometri null; kayıt korunur." if geometry is None else "Geometri geçerli."),
            "featureIndex": item["featureIndex"], "featureId": item["featureId"],
            "location": errors[0]["location"] if errors else None}


def write_validation_results(items: list[dict], max_issues: int, output_path: str) -> None:
    # A short-lived process lets the HTTP caller terminate a long GEOS operation.
    # A temporary result file avoids pipe backpressure before Process.join().
    try:
        payload = {"results": [validate_topology(item, max_issues) for item in items]}
    except Exception:
        payload = {"workerError": True}
    Path(output_path).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
