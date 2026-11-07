"""Dataset aggregate operations, each protected by a SAVEPOINT.

The caller must commit the outer Session transaction. A failed operation rolls
back its feature, catalog, ordinal and summary changes together; no method commits
unrelated work. There is no HTTP, project snapshot workflow or file importer here.
"""

from copy import deepcopy
import re

from sqlalchemy import LargeBinary, cast, func, insert, select, update
from sqlalchemy.orm import Session

from app.db.models import Dataset, Feature
from app.domain.categories import trim_name, turkish_lower, validate_catalog, validate_new_name
from app.domain.geojson import describe_feature, prepare_feature
from app.schemas.datasets import CategoryMutationResult, DatasetSummary, FeaturePage, FeatureRecord, FeatureSummary, MutationResult
from app.services.catalog import CatalogStore
from app.services.errors import NotFoundError, RevisionConflictError

_UNSET = object()


class DatasetService:
    def __init__(self, session: Session):
        self.session = session

    def create_dataset(self, name: str = "Adsız çalışma.geojson", *, source_bytes: int = 0,
                       category_catalog: object = _UNSET) -> Dataset:
        if not isinstance(name, str) or not trim_name(name):
            raise ValueError("Veri kümesi adı boş olamaz.")
        if isinstance(source_bytes, bool) or not isinstance(source_bytes, int) or source_bytes < 0:
            raise ValueError("Kaynak boyutu negatif olmayan bir tamsayı olmalı.")
        catalog = validate_catalog(category_catalog) if category_catalog is not _UNSET else []
        with self.session.begin_nested():
            dataset = Dataset(name=name, source_bytes=source_bytes)
            self.session.add(dataset)
            self.session.flush()
            store = CatalogStore(self.session, dataset.id)
            for main, children in catalog:
                store.include(main)
                for child in children:
                    store.include(main, child)
        return dataset

    def get_dataset(self, dataset_id: str) -> Dataset:
        dataset = self.session.get(Dataset, dataset_id, populate_existing=True)
        if dataset is None:
            raise NotFoundError("Veri kümesi bulunamadı.")
        return dataset

    @staticmethod
    def _summary(dataset: Dataset) -> DatasetSummary:
        return DatasetSummary(name=dataset.name, count=dataset.count, vertices=dataset.vertices,
                              bounds=deepcopy(dataset.bounds), source_bytes=dataset.source_bytes,
                              revision=dataset.revision)

    def summary(self, dataset_id: str) -> DatasetSummary:
        return self._summary(self.get_dataset(dataset_id))

    def storage_metrics(self, dataset_id: str) -> dict[str, int]:
        """Read-only budget check, including properties rather than sourceBytes."""
        self.get_dataset(dataset_id)
        count, vertices, size = self.session.execute(select(
            func.count(Feature.id), func.coalesce(func.sum(Feature.vertices), 0),
            func.coalesce(func.sum(func.length(cast(Feature.feature_json, LargeBinary))), 0),
        ).where(Feature.dataset_id == dataset_id, Feature.is_deleted.is_(False))).one()
        return {"count": count, "vertices": vertices, "bytes": size}

    def append_staging_batch(self, dataset_id: str, features: list[dict]) -> None:
        """Import-only bulk insert; caller owns the short batch transaction.

        Revision remains 0 until publication; no repeated full-table aggregation.
        """
        dataset = self.get_dataset(dataset_id)
        if dataset.status != "staging":
            raise ValueError("Import yalnızca geçici dataset'e yazabilir.")
        rows = []
        store = CatalogStore(self.session, dataset_id)
        for value in features:
            feature = prepare_feature(value)
            ordinal = dataset.next_ordinal
            label, geometry_type, vertices, bounds = describe_feature(feature, ordinal)
            rows.append(dict(dataset_id=dataset_id, ordinal=ordinal, feature_json=feature,
                             label=label, geometry_type=geometry_type, vertices=vertices, bounds=bounds, is_deleted=False))
            dataset.next_ordinal += 1
            dataset.count += 1
            dataset.vertices += vertices
            if bounds is not None:
                old = dataset.bounds
                dataset.bounds = bounds if old is None else [min(old[0],bounds[0]),min(old[1],bounds[1]),max(old[2],bounds[2]),max(old[3],bounds[3])]
            store.include_feature(feature)
        if rows:
            self.session.execute(insert(Feature.__table__), rows)
        self.session.flush()

    def _advance(self, dataset_id: str, expected_revision: int | None) -> Dataset:
        dataset = self.get_dataset(dataset_id)
        if dataset.status != "draft":
            raise ValueError("Yalnızca taslak veri kümesi düzenlenebilir.")
        if expected_revision is not None and dataset.revision != expected_revision:
            raise RevisionConflictError("Veri kümesi değişti. Güncel veriyi yeniden okuyun.")
        changed = self.session.execute(update(Dataset).where(
            Dataset.id == dataset.id, Dataset.revision == dataset.revision,
        ).values(revision=Dataset.revision + 1).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            raise RevisionConflictError("Veri kümesi değişti.")
        self.session.refresh(dataset)
        return dataset

    def _recompute(self, dataset: Dataset) -> None:
        self.session.flush()
        count, vertices, min_x, min_y, max_x, max_y = self.session.execute(select(
            func.count(Feature.id), func.coalesce(func.sum(Feature.vertices), 0),
            func.min(Feature.bounds[0].as_float()), func.min(Feature.bounds[1].as_float()),
            func.max(Feature.bounds[2].as_float()), func.max(Feature.bounds[3].as_float()),
        ).where(Feature.dataset_id == dataset.id, Feature.is_deleted.is_(False))).one()
        dataset.count, dataset.vertices = count, vertices
        dataset.bounds = [min_x, min_y, max_x, max_y] if min_x is not None else None
        self.session.flush()

    @staticmethod
    def _feature_summary(dataset: Dataset, row: Feature) -> FeatureSummary:
        return FeatureSummary(id=f"{dataset.generation_id}:{row.ordinal}", label=row.label,
                              geometry_type=row.geometry_type, vertices=row.vertices,
                              bounds=deepcopy(row.bounds))

    def _record(self, dataset: Dataset, row: Feature) -> FeatureRecord:
        return FeatureRecord(summary=self._feature_summary(dataset, row), feature=deepcopy(row.feature_json))

    def _row(self, dataset: Dataset, internal_id: str, *, include_deleted: bool = False) -> Feature:
        prefix = f"{dataset.generation_id}:"
        if not isinstance(internal_id, str) or not internal_id.startswith(prefix):
            raise ValueError("Bu şekil etkin veri kümesine ait değil.")
        ordinal_text = internal_id[len(prefix):]
        if not re.fullmatch(r"0|[1-9][0-9]*", ordinal_text) or len(ordinal_text) > 16:
            raise ValueError("Geçersiz şekil kimliği.")
        ordinal = int(ordinal_text)
        if ordinal > 9007199254740991:
            raise ValueError("Geçersiz şekil kimliği.")
        row = self.session.scalar(select(Feature).where(
            Feature.dataset_id == dataset.id, Feature.ordinal == ordinal,
        ).execution_options(populate_existing=True))
        if row is None or (row.is_deleted and not include_deleted):
            raise NotFoundError("Şekil bulunamadı.")
        return row

    def get_feature(self, dataset_id: str, internal_id: str) -> FeatureRecord:
        dataset = self.get_dataset(dataset_id)
        return self._record(dataset, self._row(dataset, internal_id))

    @staticmethod
    def _apply(row: Feature, feature: dict) -> None:
        row.feature_json = feature
        row.label, row.geometry_type, row.vertices, row.bounds = describe_feature(feature, row.ordinal)
        row.is_deleted = False

    def add_feature(self, dataset_id: str, feature: dict, *, expected_revision: int | None = None) -> MutationResult:
        clean = prepare_feature(feature)
        with self.session.begin_nested():
            dataset = self._advance(dataset_id, expected_revision)
            row = Feature(dataset_id=dataset.id, ordinal=dataset.next_ordinal)
            dataset.next_ordinal += 1
            self._apply(row, clean)
            self.session.add(row)
            CatalogStore(self.session, dataset.id).include_feature(clean)
            self._recompute(dataset)
            record = self._record(dataset, row)
            return MutationResult(id=record.summary.id, record=record, dataset=self._summary(dataset))

    def update_feature(self, dataset_id: str, internal_id: str, feature: dict, *, expected_revision: int | None = None) -> MutationResult:
        return self._replace_feature(dataset_id, internal_id, feature, restore=False, expected_revision=expected_revision)

    def restore_feature(self, dataset_id: str, internal_id: str, feature: dict, *, expected_revision: int | None = None) -> MutationResult:
        return self._replace_feature(dataset_id, internal_id, feature, restore=True, expected_revision=expected_revision)

    def _replace_feature(self, dataset_id: str, internal_id: str, feature: dict, *, restore: bool,
                         expected_revision: int | None) -> MutationResult:
        clean = prepare_feature(feature)
        with self.session.begin_nested():
            dataset = self._advance(dataset_id, expected_revision)
            row = self._row(dataset, internal_id, include_deleted=restore)
            if restore and not row.is_deleted:
                raise ValueError("Şekil zaten etkin.")
            if row.feature_json["geometry"] != clean["geometry"]:
                clean = prepare_feature(clean, remove_bbox=True)
            self._apply(row, clean)
            CatalogStore(self.session, dataset.id).include_feature(clean)
            self._recompute(dataset)
            record = self._record(dataset, row)
            return MutationResult(id=internal_id, record=record, dataset=self._summary(dataset))

    def delete_feature(self, dataset_id: str, internal_id: str, *, expected_revision: int | None = None) -> MutationResult:
        with self.session.begin_nested():
            dataset = self._advance(dataset_id, expected_revision)
            row = self._row(dataset, internal_id)
            row.is_deleted = True
            self._recompute(dataset)
            return MutationResult(id=internal_id, record=None, dataset=self._summary(dataset))

    def list_features(self, dataset_id: str, search: str = "", offset: int = 0, limit: int = 50) -> FeaturePage:
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise ValueError("offset negatif olmayan bir tamsayı olmalı.")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("limit 1–100 arasında olmalı.")
        dataset = self.get_dataset(dataset_id)
        conditions = [Feature.dataset_id == dataset.id, Feature.is_deleted.is_(False)]
        query = turkish_lower(trim_name(search))
        if query:
            conditions.append(func.instr(func.geojson_tr_lower(Feature.label + " " + Feature.geometry_type), query) > 0)
        total = self.session.scalar(select(func.count(Feature.id)).where(*conditions))
        # Do not fetch feature_json for a summary-only page.
        rows = self.session.execute(select(
            Feature.ordinal, Feature.label, Feature.geometry_type, Feature.vertices, Feature.bounds,
        ).where(*conditions).order_by(Feature.ordinal).offset(offset).limit(limit)).all()
        return FeaturePage(items=[FeatureSummary(
            id=f"{dataset.generation_id}:{row.ordinal}", label=row.label, geometry_type=row.geometry_type,
            vertices=row.vertices, bounds=row.bounds,
        ) for row in rows], total=total)

    def categories(self, dataset_id: str):
        self.get_dataset(dataset_id)
        return CatalogStore(self.session, dataset_id).list()

    def category_metadata(self, dataset_id: str) -> dict:
        return {"category_catalog": [group.model_dump() for group in self.categories(dataset_id)]}

    def add_category(self, dataset_id: str, name: str, parent: str | None = None,
                     *, expected_revision: int | None = None) -> CategoryMutationResult:
        name = validate_new_name(name)
        with self.session.begin_nested():
            dataset = self._advance(dataset_id, expected_revision)
            store = CatalogStore(self.session, dataset.id)
            if parent is None:
                if store.find(name) is not None:
                    raise ValueError("Bu ana kategori zaten var.")
                store.include(name)
            else:
                category = store.find(parent)
                if category is None:
                    raise ValueError("Alt kategori eklemek için geçerli bir ana kategori seçin.")
                if not store.include(category.name, name):
                    raise ValueError("Bu ana kategoride aynı adlı bir alt kategori zaten var.")
            return CategoryMutationResult(catalog=store.list(), dataset=self._summary(dataset))

    def import_category_catalog(self, dataset_id: str, value: object,
                                *, expected_revision: int | None = None) -> CategoryMutationResult:
        catalog = validate_catalog(value)
        with self.session.begin_nested():
            dataset = self._advance(dataset_id, expected_revision)
            store = CatalogStore(self.session, dataset.id)
            for main, children in catalog:
                store.include(main)
                for child in children:
                    store.include(main, child)
            return CategoryMutationResult(catalog=store.list(), dataset=self._summary(dataset))
