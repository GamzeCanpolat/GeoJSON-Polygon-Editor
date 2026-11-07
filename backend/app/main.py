from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from threading import BoundedSemaphore

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect
from starlette.concurrency import run_in_threadpool

from app.api.router import api_router
from app.api.errors import install_error_handlers
from app.core.config import Settings
from app.db.session import Database
from app.services.jobs import JobService


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        database = Database(settings)
        application.state.database = database
        try:
            database.initialize()
            # Do not auto-migrate a new database. Once jobs exist, mark expired
            # owners on API restart; the worker performs batched physical cleanup.
            if inspect(database.engine).has_table("jobs"):
                await run_in_threadpool(JobService(database,settings).recover)
            yield
        finally:
            database.dispose()

    application = FastAPI(
        title="GeoJSON Editor API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.state.validation_slots = BoundedSemaphore(settings.validation_max_concurrent)
    install_error_handlers(application)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "If-Match"],
        expose_headers=["ETag", "X-Dataset-Id", "X-Generation-Id", "X-Dataset-Revision", "Content-Disposition"],
    )
    application.include_router(api_router)
    return application


app = create_app()
