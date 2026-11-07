import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db.session import get_session
from app.schemas.geometry_validation import GeometryValidationReport, document_schema
from app.services.geometry_validation import GeometryValidationError, GeometryValidationService, reject_limit, strict_json_loads

router = APIRouter(tags=["Geometry validation"], responses={
    408: {"description": "Senkron doğrulama süre sınırı aşıldı"},
    413: {"description": "Boyut, koordinat veya işlem sınırı aşıldı"},
    422: {"description": "Geçersiz JSON veya GeoJSON yapısı"},
    429: {"description": "Eşzamanlı doğrulama kapasitesi dolu"},
    503: {"description": "Doğrulayıcı veya veritabanı kullanılamıyor"},
})
BODY_SCHEMA = {"requestBody": {"required": True, "content": {
    media: {"schema": document_schema()} for media in ("application/json", "application/geo+json")
}}}


@router.post("/geometry/validate", response_model=GeometryValidationReport, openapi_extra=BODY_SCHEMA)
async def validate_geometry_document(request: Request) -> GeometryValidationReport:
    settings = request.app.state.settings
    length = request.headers.get("content-length")
    if length is not None:
        try:
            if int(length) < 0:
                raise ValueError
            if int(length) > settings.validation_max_bytes:
                reject_limit("İstek gövdesi doğrulama boyut sınırını aşıyor.")
        except GeometryValidationError:
            raise
        except ValueError as error:
            raise GeometryValidationError("Geçersiz Content-Length.", code="INVALID_JSON", status_code=422) from error
    content = bytearray()
    try:
        async with asyncio.timeout(settings.validation_timeout_seconds):
            async for chunk in request.stream():
                if len(content) + len(chunk) > settings.validation_max_bytes:
                    reject_limit("İstek gövdesi doğrulama boyut sınırını aşıyor.")
                content.extend(chunk)
    except TimeoutError as error:
        raise GeometryValidationError("İstek gövdesi süre sınırında okunamadı.", code="VALIDATION_TIMEOUT", status_code=408) from error
    document = await run_in_threadpool(strict_json_loads, bytes(content))
    service = GeometryValidationService(settings, request.app.state.validation_slots)
    return await run_in_threadpool(service.validate_document, document)


@router.post("/workspaces/{workspace_id}/validate", response_model=GeometryValidationReport,
             responses={404: {"description": "Workspace bulunamadı"}})
def validate_workspace(workspace_id: UUID, request: Request,
                       session: Annotated[Session, Depends(get_session)]) -> GeometryValidationReport:
    service = GeometryValidationService(request.app.state.settings, request.app.state.validation_slots)
    return service.validate_workspace(session, str(workspace_id))
