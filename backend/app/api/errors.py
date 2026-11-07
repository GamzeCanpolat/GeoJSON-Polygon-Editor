import sqlite3
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.services.errors import NotFoundError, RevisionConflictError
from app.services.geometry_validation import GeometryValidationError
from app.services.jobs import ImportErrorResponse
from app.services.repository import RepositoryInputError, RepositoryLimitError
from app.services.spatial import SpatialLimitError


def install_error_handlers(application: FastAPI) -> None:
    @application.exception_handler(RepositoryInputError)
    async def repository_input(_request: Request, error: RepositoryInputError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @application.exception_handler(RepositoryLimitError)
    @application.exception_handler(SpatialLimitError)
    async def repository_limit(_request: Request, error: RepositoryLimitError) -> JSONResponse:
        return JSONResponse(status_code=413, content={"detail": str(error)})

    @application.exception_handler(RequestValidationError)
    async def request_validation(_request: Request, error: RequestValidationError) -> JSONResponse:
        # Omit echoed input/context: malformed JSON can contain non-finite
        # numbers or non-JSON exception objects, and Features can be very large.
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
            for item in error.errors()
        ]})

    @application.exception_handler(Exception)
    async def unexpected(_request: Request, error: Exception) -> JSONResponse:
        logging.getLogger(__name__).error("Unhandled API error", exc_info=error)
        return JSONResponse(status_code=500, content={"detail": "Beklenmeyen sunucu hatası."})

    @application.exception_handler(ImportErrorResponse)
    async def import_error(_request: Request, error: ImportErrorResponse) -> JSONResponse:
        return JSONResponse(status_code=error.status_code,content={"detail":str(error)})

    @application.exception_handler(GeometryValidationError)
    async def validation_error(_request: Request, error: GeometryValidationError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content={"detail": error.detail})

    @application.exception_handler(NotFoundError)
    async def not_found(_request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @application.exception_handler(RevisionConflictError)
    async def conflict(_request: Request, error: RevisionConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @application.exception_handler(SQLAlchemyError)
    async def storage_error(_request: Request, error: SQLAlchemyError) -> JSONResponse:
        if isinstance(error, OperationalError):
            code = getattr(error.orig, "sqlite_errorcode", 0)
            if code & 0xFF in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                return JSONResponse(status_code=409, content={"detail": "Veritabanı başka bir işlem tarafından kullanılıyor. Güncel durumu okuyup tekrar deneyin."})
        return JSONResponse(status_code=503, content={"detail": "Veritabanı işlemi tamamlanamadı."})
