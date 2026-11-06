"""Bounded, read-only validation. Structural rules are reused from the domain."""
import json
import multiprocessing
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
import time

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.domain.categories import validate_catalog
from app.domain.geojson import describe_feature, prepare_feature
from app.domain.topology import write_validation_results
from app.schemas.geometry_validation import DOCUMENT_ADAPTER, GeometryValidationReport
from app.services.datasets import DatasetService
from app.services.projects import ProjectService


class GeometryValidationError(ValueError):
    def __init__(self, message: str, *, code: str, status_code: int, path: str | None = None,
                 feature_index: int | None = None, feature_id: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = {"code": code, "message": message, "path": path,
                       "featureIndex": feature_index, "featureId": feature_id}


def reject_limit(message: str) -> None:
    raise GeometryValidationError(message, code="VALIDATION_LIMIT_EXCEEDED", status_code=413)


def strict_json_loads(data: bytes) -> object:
    from app.domain.json_numbers import json_float
    def reject_constant(_value):
        raise ValueError("NaN ve Infinity desteklenmiyor.")
    def finite_float(value):
        return json_float(value)
    def object_members(pairs):
        if any(key == "__proto__" for key, _value in pairs):
            raise ValueError("Desteklenmeyen __proto__ alanı.")
        return dict(pairs)
    try:
        return json.loads(data, parse_constant=reject_constant, parse_float=finite_float, object_pairs_hook=object_members)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise GeometryValidationError(f"Geçerli JSON ve sonlu sayılar bekleniyor. {error}", code="INVALID_JSON", status_code=422) from error


class GeometryValidationService:
    def __init__(self, settings: Settings, slots: BoundedSemaphore):
        self.settings = settings
        self.slots = slots

    def _deadline(self, started: float) -> float:
        remaining = self.settings.validation_timeout_seconds - (time.monotonic() - started)
        if remaining <= 0:
            raise GeometryValidationError("Doğrulama süre sınırını aştı.", code="VALIDATION_TIMEOUT", status_code=408)
        return remaining

    def _tree_budget(self, value: object) -> int:
        stack = [(value, 1)]
        visited = 0
        while stack:
            item, depth = stack.pop()
            visited += 1
            if depth > self.settings.validation_max_depth or visited > self.settings.validation_max_nodes:
                reject_limit("JSON derinliği veya işlem düğümü sınırı aşıldı.")
            children = item.values() if isinstance(item, dict) else item if isinstance(item, list) else ()
            stack.extend((child, depth + 1) for child in children)
        return visited

    def _item(self, value: object, index: int | None, internal_id: str | None) -> tuple[dict, int, int]:
        nodes = self._tree_budget(value)
        try:
            clean = prepare_feature(value)
        except (ValueError, TypeError, OverflowError, RecursionError) as error:
            raise GeometryValidationError(str(error)[:256], code="INVALID_GEOJSON", status_code=422,
                                          path="geometry", feature_index=index, feature_id=internal_id) from error
        vertices = describe_feature(clean, 0)[2]
        if vertices > self.settings.validation_max_feature_vertices:
            reject_limit("Tek Feature için koordinat sayısı sınırı aşıldı.")
        has_z = False
        stack = [clean["geometry"]]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                stack.extend(node.get("geometries", []) if node.get("type") == "GeometryCollection" else [node.get("coordinates", [])])
            elif isinstance(node, list) and node:
                if isinstance(node[0], (int, float)):
                    has_z |= len(node) > 2
                else:
                    stack.extend(node)
        return {"geometry": clean["geometry"], "featureIndex": index, "featureId": internal_id, "hasZ": has_z}, vertices, nodes

    def _report(self, items: list[dict], *, geometry_type: str | None, started: float, **context) -> GeometryValidationReport:
        if not items:
            results = []
        else:
            if not self.slots.acquire(blocking=False):
                raise GeometryValidationError("Doğrulama kapasitesi dolu. Daha sonra tekrar deneyin.", code="VALIDATION_BUSY", status_code=429)
            try:
                with TemporaryDirectory(prefix="geojson-validation-") as directory:
                    output = Path(directory) / "results.json"
                    process = multiprocessing.get_context("spawn").Process(
                        target=write_validation_results,
                        args=(items, self.settings.validation_max_issues_per_feature, str(output)),
                        daemon=True,
                    )
                    try:
                        self._deadline(started)
                        process.start()
                        process.join(max(0, self.settings.validation_timeout_seconds - (time.monotonic() - started)))
                        if process.is_alive():
                            raise GeometryValidationError("Doğrulama süre sınırını aştı.", code="VALIDATION_TIMEOUT", status_code=408)
                        if process.exitcode != 0 or not output.is_file():
                            raise GeometryValidationError("Geometri doğrulayıcısı tamamlanamadı.", code="VALIDATOR_UNAVAILABLE", status_code=503)
                        payload = json.loads(output.read_text(encoding="utf-8"))
                        if payload.get("workerError"):
                            raise GeometryValidationError("Geometri doğrulayıcısı tamamlanamadı.", code="VALIDATOR_UNAVAILABLE", status_code=503)
                        results = payload["results"]
                    except (OSError, RuntimeError, json.JSONDecodeError, KeyError) as error:
                        raise GeometryValidationError("Geometri doğrulayıcısı kullanılamıyor.", code="VALIDATOR_UNAVAILABLE", status_code=503) from error
                    finally:
                        if process.pid is not None:
                            if process.is_alive():
                                process.terminate()
                                process.join(1)
                                if process.is_alive():
                                    process.kill()
                                    process.join()
                            process.close()
            finally:
                self.slots.release()
        errors = [issue for result in results for issue in result["errors"]]
        warnings = [issue for result in results for issue in result["warnings"]]
        return GeometryValidationReport(
            valid=not errors, geometry_type=geometry_type, errors=errors, warnings=warnings,
            message=errors[0]["message"] if errors else "Doğrulama tamamlandı; geçersiz geometri bulunmadı.",
            feature_id=items[0]["featureId"] if len(items) == 1 and items[0]["featureIndex"] is None else None,
            location=errors[0]["location"] if errors else None, results=results, feature_count=len(results), **context,
        )

    def validate_document(self, document: object) -> GeometryValidationReport:
        started = time.monotonic()
        self._tree_budget(document)
        try:
            DOCUMENT_ADAPTER.validate_python(document)
            if len(json.dumps(document, allow_nan=False, ensure_ascii=False).encode("utf-8")) > self.settings.validation_max_bytes:
                reject_limit("Doğrulama belgesi boyut sınırını aşıyor.")
        except GeometryValidationError:
            raise
        except ValidationError as error:
            index = None
            for item in error.errors(include_input=False, include_context=False, include_url=False):
                location = item["loc"]
                if "features" in location:
                    index = next((part for part in location if isinstance(part, int)), None)
                    if index is not None:
                        break
            raise GeometryValidationError("Feature veya FeatureCollection nesne yapısı geçersiz.",
                                          code="INVALID_GEOJSON", status_code=422,
                                          path=f"features[{index}]" if index is not None else None, feature_index=index) from error
        except (ValueError, TypeError, RecursionError) as error:
            raise GeometryValidationError("Feature veya FeatureCollection yapısı ve sonlu JSON değerleri bekleniyor.",
                                          code="INVALID_GEOJSON", status_code=422) from error
        collection = document["type"] == "FeatureCollection"
        features = document["features"] if collection else [document]
        if len(features) > self.settings.validation_max_features:
            reject_limit("Feature sayısı doğrulama sınırını aşıyor.")
        if collection and "category_catalog" in document:
            try:
                validate_catalog(document["category_catalog"])
            except ValueError as error:
                raise GeometryValidationError(str(error), code="INVALID_GEOJSON", status_code=422, path="category_catalog") from error
        items, total_vertices = [], 0
        for index, feature in enumerate(features):
            item, vertices, _nodes = self._item(feature, index if collection else None, None)
            total_vertices += vertices
            if total_vertices > self.settings.validation_max_vertices:
                reject_limit("Toplam koordinat sayısı doğrulama sınırını aşıyor.")
            items.append(item)
            self._deadline(started)
        return self._report(items, geometry_type="FeatureCollection" if collection else items[0]["geometry"]["type"] if items[0]["geometry"] is not None else None,
                            started=started)

    def validate_workspace(self, session: Session, workspace_id: str) -> GeometryValidationReport:
        started = time.monotonic()
        workspace = ProjectService(session).get_workspace(workspace_id)
        service = DatasetService(session)
        if workspace.dataset.count > self.settings.validation_max_features or workspace.dataset.vertices > self.settings.validation_max_vertices:
            reject_limit("Workspace senkron doğrulama sınırlarını aşıyor.")
        metrics = service.storage_metrics(workspace.active_dataset_id)
        if metrics["count"] > self.settings.validation_max_features or metrics["bytes"] > self.settings.validation_max_bytes or metrics["vertices"] > self.settings.validation_max_vertices:
            reject_limit("Workspace boyutu veya koordinat sayısı doğrulama sınırlarını aşıyor.")
        items, vertices, nodes = [], 0, 0
        for offset in range(0, metrics["count"], 100):
            page = service.list_features(workspace.active_dataset_id, offset=offset, limit=100)
            for summary in page.items:
                record = service.get_feature(workspace.active_dataset_id, summary.id)
                item, count, node_count = self._item(record.feature, len(items), summary.id)
                vertices += count
                nodes += node_count
                if nodes > self.settings.validation_max_nodes:
                    reject_limit("Workspace işlem düğümü sınırı aşıldı.")
                if vertices > self.settings.validation_max_vertices:
                    reject_limit("Toplam koordinat sayısı doğrulama sınırını aşıyor.")
                items.append(item)
                self._deadline(started)
        return self._report(items, geometry_type="FeatureCollection", started=started,
                            workspace_id=workspace.id, dataset_id=workspace.active_dataset_id,
                            generation_id=workspace.generation_id, revision=workspace.dataset.revision)
