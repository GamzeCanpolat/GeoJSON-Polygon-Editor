import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.core.config import BACKEND_DIR, Settings
from app.db.session import Database
from app.services.datasets import DatasetService
from app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        database_path=tmp_path / "database/projects.db",
        sqlite_busy_timeout_ms=5000,
        cors_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    )


@pytest.fixture
def application(settings):
    return create_app(settings)


@pytest.fixture
def client(application):
    # Entering TestClient runs the same lifespan startup/shutdown as Uvicorn.
    with TestClient(application) as test_client:
        yield test_client


@pytest.fixture
def migrated_database(settings, monkeypatch):
    monkeypatch.setenv("GEOJSON_DATABASE_PATH", str(settings.database_path))
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")
    database = Database(settings)
    database.initialize()
    try:
        yield database
    finally:
        database.dispose()


@pytest.fixture
def session(migrated_database):
    with migrated_database.sessions() as session:
        yield session


@pytest.fixture
def service(session):
    return DatasetService(session)
