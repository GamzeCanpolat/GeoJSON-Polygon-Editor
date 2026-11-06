"""One Feature at a time, including bounded single-Feature/geometry roots."""
from decimal import Decimal
import math

import ijson
from ijson.common import ObjectBuilder


class StreamFormatError(ValueError):
    pass


def _value(first, events, *, max_bytes, max_depth, max_nodes):
    builder = ObjectBuilder()
    depth = nodes = size = 0
    event, value = first
    while True:
        nodes += 1
        if isinstance(value, Decimal):
            value = float(value)
            if not math.isfinite(value):
                raise StreamFormatError("Sonlu JSON sayıları bekleniyor.")
        size += len(value.encode("utf-8")) + 4 if isinstance(value, str) else 32 if event == "number" else 1
        if nodes > max_nodes or size > max_bytes:
            raise StreamFormatError("Tek Feature veya metadata boyut/işlem sınırı aşıldı.")
        if event in ("start_map", "start_array"):
            depth += 1
        if depth > max_depth:
            raise StreamFormatError("JSON derinlik sınırı aşıldı.")
        builder.event(event, value)
        if event in ("end_map", "end_array"):
            depth -= 1
        if depth == 0:
            return builder.value, size, nodes
        event, value = next(events)


def _root_type(reader, settings):
    """Disambiguate a foreign features member without retaining a collection.

    Only needed when features precedes type. Uploaded files are seekable; the
    original ijson iterator keeps its current buffer while this bounded-memory
    scan temporarily rewinds the underlying reader, then restores its cursor.
    """
    try:
        position = reader.tell()
        reader.seek(0)
    except (AttributeError, OSError, ValueError) as error:
        raise StreamFormatError("type alanından önce features içeren GeoJSON için yeniden okunabilir dosya gerekli.") from error
    try:
        depth = 0
        events = iter(ijson.basic_parse(reader, buf_size=settings.import_chunk_bytes))
        for event, value in events:
            if event in ("start_map", "start_array"):
                depth += 1
                # Collection root + features array surround each bounded
                # Feature. Exact per-Feature limits remain in the main pass.
                if depth > settings.import_max_depth + 2:
                    raise StreamFormatError("JSON derinlik sınırı aşıldı.")
            elif event in ("end_map", "end_array"):
                depth -= 1
            elif event == "map_key" and depth == 1 and value == "type":
                event, value = next(events)
                if event != "string":
                    raise StreamFormatError("GeoJSON type alanı metin olmalı.")
                return value
        raise StreamFormatError("GeoJSON type alanı gerekli.")
    finally:
        reader.seek(position)


def stream_collection(reader, settings):
    """Yield ('feature', object, estimated_bytes) then ('metadata', root, bytes).

    Keys/prefix strings are not used for navigation: dots in user keys are safe.
    FeatureCollection features are released immediately. A single Feature or
    bare geometry fits the same per-Feature budget and is normalized only at
    the envelope level, matching the local repository's open() behavior.
    Final Feature/category validation belongs to the consumer before completion.
    """
    events = iter(ijson.basic_parse(reader, buf_size=settings.import_chunk_bytes))
    try:
        if next(events) != ("start_map", None):
            raise StreamFormatError("GeoJSON kökü bir FeatureCollection, Feature veya geometri nesnesi olmalı.")
        metadata, seen, metadata_bytes, metadata_nodes = {}, set(), 2, 2
        root_type = None
        while True:
            event, key = next(events)
            if event == "end_map":
                break
            if event != "map_key" or key in seen:
                raise StreamFormatError("Geçersiz veya tekrarlanan kök JSON alanı.")
            seen.add(key)
            first = next(events)
            if key == "features" and "type" not in metadata and root_type is None:
                root_type = _root_type(reader, settings)
            if key == "features" and root_type == "FeatureCollection":
                if first != ("start_array", None):
                    raise StreamFormatError("FeatureCollection.features bir dizi olmalı.")
                while True:
                    first = next(events)
                    if first == ("end_array", None):
                        break
                    value, size, _nodes = _value(first, events, max_bytes=settings.import_max_feature_bytes,
                                                 max_depth=settings.import_max_depth, max_nodes=settings.import_max_feature_nodes)
                    yield "feature", value, size
            else:
                # JSON object member order is arbitrary. Until type is known,
                # root fields may belong to one Feature, not collection metadata.
                # Still bound the aggregate root instead of each field alone.
                maximum = (settings.import_max_metadata_bytes if root_type == "FeatureCollection"
                           else settings.import_max_feature_bytes)
                value, size, nodes = _value(first, events, max_bytes=maximum,
                                            max_depth=settings.import_max_depth - 1,
                                            max_nodes=settings.import_max_feature_nodes)
                metadata_bytes += size + len(key.encode("utf-8"))
                metadata_nodes += nodes + 1
                metadata[key] = value
                if key == "type":
                    root_type = value
                maximum = (settings.import_max_metadata_bytes if root_type == "FeatureCollection"
                           else settings.import_max_feature_bytes)
                if metadata_bytes > maximum or metadata_nodes > settings.import_max_feature_nodes:
                    raise StreamFormatError("Kök Feature veya metadata boyut/işlem sınırı aşıldı.")
        if next(events, None) is not None:
            raise StreamFormatError("JSON kökünden sonra fazladan veri var.")
        root_type = metadata.get("type")
        if root_type == "FeatureCollection":
            if "features" not in seen or "features" in metadata:
                raise StreamFormatError("FeatureCollection türü ve features dizisi gerekli.")
            yield "metadata", metadata, metadata_bytes
        else:
            if metadata_bytes > settings.import_max_feature_bytes or metadata_nodes > settings.import_max_feature_nodes:
                raise StreamFormatError("Kök Feature boyut/işlem sınırı aşıldı.")
            if root_type == "Feature":
                feature = metadata
            elif isinstance(root_type, str) and root_type in {
                "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"
            }:
                feature = {"type": "Feature", "properties": {}, "geometry": metadata}
            else:
                raise StreamFormatError("FeatureCollection, Feature veya GeoJSON geometrisi bekleniyor.")
            yield "feature", feature, metadata_bytes
            # Foreign fields on a Feature/geometry belong to that object, never
            # to collection metadata (including a foreign category_catalog).
            yield "metadata", {"type": "FeatureCollection"}, 0
    except (StopIteration, ijson.JSONError, UnicodeError, OverflowError) as error:
        raise StreamFormatError("GeoJSON eksik, bozuk veya desteklenmeyen sayısal değer içeriyor.") from error
