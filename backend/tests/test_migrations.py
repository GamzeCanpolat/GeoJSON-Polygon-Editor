from io import StringIO
from pathlib import Path
import shutil

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app.core.config import BACKEND_DIR
from app.db.models import Dataset, Feature, Project, Workspace
from app.db.session import create_database_engine

TABLES = {"projects", "workspaces", "datasets", "features", "categories", "subcategories", "jobs", "alembic_version",
          "feature_rtree", "feature_rtree_node", "feature_rtree_parent", "feature_rtree_rowid"}


def migration_config():
    return Config(str(BACKEND_DIR / "alembic.ini"), stdout=StringIO())


def test_migration_upgrade_schema_and_existing_rows(settings, monkeypatch):
    monkeypatch.setenv("GEOJSON_DATABASE_PATH", str(settings.database_path))
    config = migration_config()
    assert ScriptDirectory.from_config(config).get_heads() == ["0003_spatial_index"]
    command.upgrade(config, "head")
    command.current(config)
    command.check(config)
    engine = create_database_engine(settings)
    try:
        inspector = inspect(engine)
        assert set(inspector.get_table_names()) == TABLES
        assert [column["name"] for column in inspector.get_columns("features")] == [
            "id", "dataset_id", "ordinal", "feature_json", "geometry_type", "label", "vertices", "bounds", "is_deleted",
        ]
        assert any(c["column_names"] == ["dataset_id", "ordinal"] for c in inspector.get_unique_constraints("features"))
        assert any(c["column_names"] == ["dataset_id", "normalized_name"] for c in inspector.get_unique_constraints("categories"))
        assert any(i["column_names"] == ["dataset_id", "is_deleted", "ordinal"] for i in inspector.get_indexes("features"))
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO datasets (id,generation_id,name,created_at) VALUES ('existing','generation','keep me',CURRENT_TIMESTAMP)"))
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0003_spatial_index"
            assert connection.execute(text("SELECT name FROM datasets WHERE id='existing'")).scalar_one() == "keep me"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    finally:
        engine.dispose()


def test_offline_migrations_do_not_create_database(settings, monkeypatch):
    monkeypatch.setenv("GEOJSON_DATABASE_PATH", str(settings.database_path))
    config = migration_config()
    config.output_buffer = StringIO()
    command.upgrade(config, "head", sql=True)
    assert "CREATE TABLE features" in config.output_buffer.getvalue()
    assert not settings.database_path.exists()


def test_0002_additive_upgrade_preserves_0001_user_rows(settings,monkeypatch):
    monkeypatch.setenv('GEOJSON_DATABASE_PATH',str(settings.database_path))
    config=migration_config()
    command.upgrade(config,'0001_data_models')
    engine=create_database_engine(settings)
    try:
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO datasets(id,generation_id,name,created_at) VALUES('old','generation','keep',CURRENT_TIMESTAMP)"))
            connection.execute(text("INSERT INTO projects(id,name,saved_dataset_id,created_at,updated_at) VALUES('project','keep','old',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
        command.upgrade(config,'head')
        command.check(config)
        with engine.connect() as connection:
            assert connection.execute(text("SELECT name,metadata_json FROM datasets WHERE id='old'")).one()==('keep','{}')
            assert connection.execute(text("SELECT saved_dataset_id FROM projects WHERE id='project'")).scalar_one()=='old'
        command.downgrade(config,'0001_data_models')
        with engine.connect() as connection:
            assert connection.execute(text("SELECT name FROM datasets WHERE id='old'")).scalar_one()=='keep'
        command.upgrade(config,'head')
    finally: engine.dispose()


def test_revision_template_and_downgrade_with_related_rows(settings, tmp_path, monkeypatch, migrated_database):
    monkeypatch.setenv("GEOJSON_DATABASE_PATH", str(settings.database_path))
    migration_dir = tmp_path / "migrations"
    shutil.copytree(BACKEND_DIR / "migrations", migration_dir, ignore=shutil.ignore_patterns("__pycache__"))
    config = migration_config()
    config.set_main_option("script_location", str(migration_dir))
    revision = command.revision(config, message="temporary infrastructure probe", autogenerate=True)
    assert revision is not None and Path(revision.path).is_file()
    command.upgrade(config, "head")
    with migrated_database.sessions.begin() as session:
        dataset = Dataset(name="temporary")
        session.add(dataset)
        session.flush()
        project = Project(name="temporary", saved_dataset_id=dataset.id)
        session.add(project)
        session.flush()
        session.add(Workspace(project_id=project.id, active_dataset_id=dataset.id))
        session.add(Feature(dataset_id=dataset.id, ordinal=0, feature_json={"type": "Feature", "properties": None, "geometry": None}, geometry_type="Geometri yok", label="test", vertices=0))
    with migrated_database.engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == revision.revision
    command.check(config)
    command.downgrade(config, "base")
    assert inspect(migrated_database.engine).get_table_names() == ["alembic_version"]
    command.upgrade(config, "head")
    command.check(config)
    assert set(inspect(migrated_database.engine).get_table_names()) == TABLES
