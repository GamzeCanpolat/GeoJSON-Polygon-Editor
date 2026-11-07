"""Database-local copies; caller owns the transaction and source write lock."""
from copy import deepcopy

from sqlalchemy import and_, delete, exists, insert, literal, select
from sqlalchemy.orm import Session

from app.db.models import Category, Dataset, Feature, Project, Subcategory, Workspace


def copy_dataset(session: Session, source: Dataset, *, status: str) -> Dataset:
    target = Dataset(
        generation_id=source.generation_id, name=source.name, revision=source.revision,
        count=source.count, vertices=source.vertices, bounds=deepcopy(source.bounds),
        source_bytes=source.source_bytes, next_ordinal=source.next_ordinal, status=status,
        metadata_json=deepcopy(source.metadata_json),
    )
    session.add(target)
    session.flush()

    # INSERT ... SELECT preserves the stored JSON without parsing/rebuilding it
    # and avoids loading every geometry into Python memory. Copy tombstones too.
    fields = ["ordinal", "feature_json", "geometry_type", "label", "vertices", "bounds", "is_deleted"]
    features = Feature.__table__
    session.execute(insert(features).from_select(
        ["dataset_id", *fields],
        select(literal(target.id), *(features.c[name] for name in fields))
        .where(features.c.dataset_id == source.id).order_by(features.c.ordinal),
    ))
    categories = Category.__table__
    session.execute(insert(categories).from_select(
        ["dataset_id", "name", "normalized_name"],
        select(literal(target.id), categories.c.name, categories.c.normalized_name)
        .where(categories.c.dataset_id == source.id),
    ))
    old = categories.alias("source_category")
    new = categories.alias("target_category")
    children = Subcategory.__table__
    session.execute(insert(children).from_select(
        ["category_id", "name", "normalized_name"],
        select(new.c.id, children.c.name, children.c.normalized_name)
        .select_from(children.join(old, children.c.category_id == old.c.id).join(
            new, and_(new.c.dataset_id == target.id, new.c.normalized_name == old.c.normalized_name),
        )).where(old.c.dataset_id == source.id),
    ))
    return target


def remove_unreferenced_dataset(session: Session, dataset_id: str) -> None:
    """RESTRICT foreign keys remain a final guard against deleting shared data."""
    session.execute(delete(Dataset).where(
        Dataset.id == dataset_id,
        ~exists(select(Project.id).where(Project.saved_dataset_id == dataset_id)),
        ~exists(select(Workspace.id).where(Workspace.active_dataset_id == dataset_id)),
    ).execution_options(synchronize_session=False))
