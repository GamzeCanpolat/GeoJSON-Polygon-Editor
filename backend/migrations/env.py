from logging.config import fileConfig

from alembic import context

from app.core.config import Settings
from app.db.base import Base
from app.db import models  # noqa: F401 — register all ORM tables in Base.metadata
from app.db.session import create_database_engine, database_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# All mapped classes must be imported before reading their metadata.
target_metadata = Base.metadata
settings = Settings()

# R-Tree and its SQLite-managed shadow tables belong to migration 0003 rather
# than ORM metadata. Do not reflect them or propose dropping them on autogenerate.
SPATIAL_TABLES = {"feature_rtree", "feature_rtree_node", "feature_rtree_parent", "feature_rtree_rowid"}


def include_name(name, type_, parent_names):
    return not (type_ == "table" and name in SPATIAL_TABLES)


def include_object(object_, name, type_, reflected, compare_to):
    return not (type_ == "table" and name in SPATIAL_TABLES)

# The engine explicitly emits BEGIN, so SQLite DDL really is transactional.
# Alembic must use the same transaction policy, including an empty revision tree.


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(settings),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
        transactional_ddl=True,
        include_name=include_name,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_database_engine(settings)
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                render_as_batch=True,
                compare_type=True,
                transactional_ddl=True,
                include_name=include_name,
                include_object=include_object,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
