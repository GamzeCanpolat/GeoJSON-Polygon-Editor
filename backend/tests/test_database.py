from typing import Annotated

import pytest
from fastapi import Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR, Settings
from app.db.session import get_session
from app.main import create_app


def test_relative_database_path_is_independent_of_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(_env_file=None, database_path="var/database/projects.db")
    assert settings.database_path == BACKEND_DIR / "var/database/projects.db"


@pytest.mark.parametrize("timeout", [0, -1, 120_001])
def test_invalid_busy_timeout_is_rejected(timeout):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, sqlite_busy_timeout_ms=timeout)


def test_constructing_app_does_not_create_database(settings):
    create_app(settings)
    assert not settings.database_path.exists()


def test_connection_settings_apply_to_every_connection(application, client):
    engine = application.state.database.engine
    # Keep both checked out to exercise separate DBAPI connections.
    with engine.connect() as first, engine.connect() as second:
        for connection in (first, second):
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            assert connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
            assert connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one() == 5000
    # Startup still never creates application tables; Alembic owns the schema.
    assert inspect(engine).get_table_names() == []


def test_foreign_keys_are_actually_enforced(application, client):
    with application.state.database.engine.connect() as connection:
        connection.exec_driver_sql("CREATE TEMP TABLE parent_probe (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TEMP TABLE child_probe (id INTEGER PRIMARY KEY, "
            "parent_id INTEGER REFERENCES parent_probe(id))"
        )
        with pytest.raises(IntegrityError):
            connection.exec_driver_sql("INSERT INTO child_probe VALUES (1, 999)")


def test_session_dependency_rolls_back_failed_requests(application, client):
    engine = application.state.database.engine
    # A test-only table and route; nothing is added to the shipped API/schema.
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE transaction_probe (id INTEGER PRIMARY KEY)")

    @application.post("/_test/rollback")
    def fail(session: Annotated[Session, Depends(get_session)]):
        session.execute(text("INSERT INTO transaction_probe VALUES (1)"))
        raise HTTPException(status_code=400, detail="rollback probe")

    assert client.post("/_test/rollback").status_code == 400
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM transaction_probe")).scalar_one() == 0
