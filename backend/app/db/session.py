from collections.abc import Generator
from sqlite3 import Connection as SQLiteConnection

from fastapi import Request
from sqlalchemy import URL, create_engine, event, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.domain.categories import turkish_lower


def database_url(settings: Settings) -> URL:
    return URL.create("sqlite+pysqlite", database=str(settings.database_path))


def create_database_engine(settings: Settings) -> Engine:
    """Create the directory and engine without creating any application tables."""
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        database_url(settings),
        connect_args={
            "check_same_thread": False,
            "timeout": settings.sqlite_busy_timeout_ms / 1000,
        },
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection: SQLiteConnection, _record: object) -> None:
        # Disable sqlite3's legacy implicit BEGIN handling. SQLAlchemy owns BEGIN
        # below, including transactional DDL and repeatable reads for migrations.
        connection.isolation_level = None
        connection.create_function("geojson_tr_lower", 1, turkish_lower, deterministic=True)
        cursor = connection.cursor()
        try:
            cursor.execute(f"PRAGMA busy_timeout={settings.sqlite_busy_timeout_ms}")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            if cursor.fetchone()[0].lower() != "wal":
                raise RuntimeError("SQLite WAL mode could not be enabled.")
            cursor.execute("PRAGMA foreign_keys")
            if cursor.fetchone()[0] != 1:
                raise RuntimeError("SQLite foreign key enforcement could not be enabled.")
        finally:
            cursor.close()

    @event.listens_for(engine, "begin")
    def begin_transaction(connection: Connection) -> None:
        connection.exec_driver_sql("BEGIN")

    return engine


class Database:
    def __init__(self, settings: Settings) -> None:
        self.engine = create_database_engine(settings)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

    def initialize(self) -> None:
        # Connecting creates projects.db. Schema changes belong to Alembic.
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    def dispose(self) -> None:
        self.engine.dispose()


def get_session(request: Request) -> Generator[Session, None, None]:
    """One session per request; callers explicitly commit successful writes.

    The context manager closes the session and rolls back unfinished work,
    including when an endpoint raises an exception.
    """
    database: Database = request.app.state.database
    with database.sessions() as session:
        yield session
