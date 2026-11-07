"""Catalog storage helpers; the aggregate service owns transaction/revision."""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Category, Subcategory
from app.domain.categories import category_key, category_sort_key, trim_name
from app.schemas.datasets import CategoryGroup


class CatalogStore:
    def __init__(self, session: Session, dataset_id: str):
        self.session = session
        self.dataset_id = dataset_id

    def find(self, name: str) -> Category | None:
        return self.session.scalar(select(Category).where(
            Category.dataset_id == self.dataset_id,
            Category.normalized_name == category_key(name),
        ))

    def include(self, name: str, sub: str = "") -> bool:
        """Merge metadata/feature names, keeping the first display spelling."""
        name, sub = trim_name(name), trim_name(sub)
        if not name:
            return False
        changed = False
        category = self.find(name)
        if category is None:
            category = Category(dataset_id=self.dataset_id, name=name, normalized_name=category_key(name))
            self.session.add(category)
            self.session.flush()
            changed = True
        if sub:
            existing = self.session.scalar(select(Subcategory.id).where(
                Subcategory.category_id == category.id,
                Subcategory.normalized_name == category_key(sub),
            ))
            if existing is None:
                self.session.add(Subcategory(category_id=category.id, name=sub, normalized_name=category_key(sub)))
                self.session.flush()
                changed = True
        return changed

    def include_feature(self, feature: dict) -> None:
        properties = feature["properties"] or {}
        def text(key: str) -> str:
            value = properties.get(key)
            return trim_name(value) if isinstance(value, str) else ""
        self.include(text("ana_kategori") or text("kategori"), text("alt_kategori"))

    def list(self) -> list[CategoryGroup]:
        categories = self.session.scalars(select(Category).where(
            Category.dataset_id == self.dataset_id,
        ).options(selectinload(Category.subcategories)).execution_options(populate_existing=True)).all()
        return [CategoryGroup(
            name=category.name,
            subcategories=sorted((child.name for child in category.subcategories), key=category_sort_key),
        ) for category in sorted(categories, key=lambda category: category_sort_key(category.name))]
