"""Shared structural rules. Read-only topological analysis lives in topology.py."""

from copy import deepcopy
import json
import math
from typing import Any


def _position(value: object) -> None:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError("Koordinatlar en az iki sonlu sayı içermeli.")
    for number in value:
        if isinstance(number, int) and not isinstance(number, bool) and abs(number) > 2**53 - 1:
            raise ValueError("Koordinat hassasiyet kaybı olmadan harita sayısı olarak işlenemiyor.")
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
            raise ValueError("Koordinatlar sonlu sayı içermeli.")
        if isinstance(number, float) and number.is_integer() and abs(number) > 2**53 - 1:
            raise ValueError("Koordinat hassasiyet kaybı olmadan harita sayısı olarak işlenemiyor.")
    if not -180 <= value[0] <= 180 or not -90 <= value[1] <= 90:
        raise ValueError("WGS84 koordinatları bekleniyor: [boylam, enlem].")


def _array(value: object) -> list:
    if not isinstance(value, list):
        raise ValueError("Geometri koordinatları bir dizi olmalı.")
    return value


def _line(value: object, ring: bool = False) -> None:
    positions = _array(value)
    if len(positions) < (4 if ring else 2):
        raise ValueError("Poligon halkası en az dört, çizgi en az iki koordinat içermeli.")
    for position in positions:
        _position(position)
    if ring and positions[0] != positions[-1]:
        raise ValueError("Poligon halkasının ilk ve son koordinatı aynı olmalı.")


def validate_geometry(value: object) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise ValueError("Geçerli bir GeoJSON geometrisi bekleniyor.")
    coordinates = value.get("coordinates")
    match value.get("type"):
        case "Point":
            _position(coordinates)
        case "MultiPoint":
            for point in _array(coordinates):
                _position(point)
        case "LineString":
            _line(coordinates)
        case "MultiLineString":
            for line in _array(coordinates):
                _line(line)
        case "Polygon":
            for ring in _array(coordinates):
                _line(ring, ring=True)
        case "MultiPolygon":
            for polygon in _array(coordinates):
                for ring in _array(polygon):
                    _line(ring, ring=True)
        case "GeometryCollection":
            for geometry in _array(value.get("geometries")):
                validate_geometry(geometry)
        case _:
            raise ValueError("Desteklenmeyen geometri türü.")


def prepare_feature(value: object, *, remove_bbox: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("type") != "Feature":
        raise ValueError("Her kayıt GeoJSON Feature türünde olmalı.")
    if "properties" not in value or (value["properties"] is not None and not isinstance(value["properties"], dict)):
        raise ValueError("properties bir nesne veya null olmalı.")
    if "geometry" not in value:
        raise ValueError("geometry alanı gerekli.")
    if "id" in value and (isinstance(value["id"], bool) or not isinstance(value["id"], (str, int, float))):
        raise ValueError("Feature id bir metin veya sayı olmalı.")
    # Never coerce properties or discard foreign members. Reject non-JSON values
    # rather than serializing NaN/Infinity or silently changing dictionary keys.
    def check_json(item: object) -> None:
        if isinstance(item, dict):
            if any(not isinstance(key, str) for key in item):
                raise ValueError("JSON nesne anahtarları metin olmalı.")
            if "__proto__" in item:
                raise ValueError("Desteklenmeyen __proto__ alanı.")
            for child in item.values():
                check_json(child)
        elif isinstance(item, list):
            for child in item:
                check_json(child)
        elif item is not None and not isinstance(item, (str, int, float, bool)):
            raise ValueError("Yalnızca JSON değerleri destekleniyor.")
    check_json(value)
    json.dumps(value, allow_nan=False)
    validate_geometry(value["geometry"])
    feature = deepcopy(value)
    if remove_bbox:
        feature.pop("bbox", None)
        def clean(geometry: dict | None) -> None:
            if geometry is None:
                return
            geometry.pop("bbox", None)
            if geometry["type"] == "GeometryCollection":
                for child in geometry["geometries"]:
                    clean(child)
        clean(feature["geometry"])
    return feature


def _js_string(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, dict):
        return "[object Object]"
    if isinstance(value, list):
        return ",".join("" if child is None else _js_string(child) for child in value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def describe_feature(feature: dict[str, Any], ordinal: int) -> tuple[str, str, int, list[float] | None]:
    vertices = 0
    bounds = [math.inf, math.inf, -math.inf, -math.inf]

    def walk(coordinates: list) -> None:
        nonlocal vertices
        if not coordinates:
            return
        if isinstance(coordinates[0], (int, float)):
            vertices += 1
            x, y = coordinates[:2]
            bounds[0] = min(bounds[0], x)
            bounds[1] = min(bounds[1], y)
            bounds[2] = max(bounds[2], x)
            bounds[3] = max(bounds[3], y)
        else:
            for child in coordinates:
                walk(child)

    def visit(geometry: dict | None) -> None:
        if geometry is None:
            return
        if geometry["type"] == "GeometryCollection":
            for child in geometry["geometries"]:
                visit(child)
        else:
            walk(geometry["coordinates"])

    visit(feature["geometry"])
    properties = feature["properties"] or {}
    label = next((properties[key] for key in ("name", "ad", "title", "NAME") if properties.get(key) is not None), None)
    if label is None:
        label = feature.get("id", f"Şekil {ordinal + 1}")
    geometry_type = feature["geometry"]["type"] if feature["geometry"] else "Geometri yok"
    return _js_string(label)[:160], geometry_type, vertices, bounds if vertices else None
