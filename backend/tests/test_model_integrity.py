import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.db.models import Category, Dataset, Feature, Project, Subcategory, Workspace


def test_project_workspace_relationships_and_delete_policies(service, session):
    dataset = service.create_dataset()
    project = Project(name="Proje", saved_dataset_id=dataset.id)
    session.add(project)
    session.flush()
    workspace = Workspace(project_id=project.id, active_dataset_id=dataset.id)
    session.add(workspace)
    session.flush()
    assert workspace.project.name == "Proje"
    assert workspace.active_dataset.id == project.saved_dataset.id
    assert project.version == 1 and project.created_at is not None
    with pytest.raises(IntegrityError), session.begin_nested():
        session.execute(delete(Dataset).where(Dataset.id == dataset.id))
    session.execute(delete(Project).where(Project.id == project.id))
    session.refresh(workspace)
    assert workspace.project_id is None
    # Still referenced by workspace, so deleting the dataset remains forbidden.
    with pytest.raises(IntegrityError), session.begin_nested():
        session.execute(delete(Dataset).where(Dataset.id == dataset.id))


def test_database_unique_constraints_and_cascade(service, session):
    dataset = service.create_dataset()
    service.add_feature(dataset.id, {"type": "Feature", "properties": {}, "geometry": None})
    service.add_category(dataset.id, "Park")
    service.add_category(dataset.id, "Alt", parent="Park")
    row = session.scalar(select(Feature))
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(Feature(dataset_id=dataset.id, ordinal=row.ordinal, feature_json=row.feature_json,
                            geometry_type=row.geometry_type, label="duplicate", vertices=0))
        session.flush()
    category = session.scalar(select(Category))
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(Category(dataset_id=dataset.id, name="park", normalized_name="park"))
        session.flush()
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(Subcategory(category_id=category.id, name="alt", normalized_name="alt"))
        session.flush()
    session.execute(delete(Dataset).where(Dataset.id == dataset.id))
    for table in ("features", "categories", "subcategories"):
        assert session.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0


def test_foreign_keys_and_check_constraints_are_enforced(service, session):
    dataset = service.create_dataset()
    for statement in [
        "UPDATE datasets SET revision=-1", "UPDATE datasets SET count=-1",
        "UPDATE datasets SET vertices=-1", "UPDATE datasets SET next_ordinal=-1",
        "UPDATE datasets SET source_bytes=-1", "UPDATE datasets SET status='invalid'",
    ]:
        with pytest.raises(IntegrityError), session.begin_nested():
            session.execute(text(statement))
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(Workspace(active_dataset_id="missing"))
        session.flush()
    assert service.summary(dataset.id).revision == 0
