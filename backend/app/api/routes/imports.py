from uuid import UUID
from urllib.parse import quote

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from app.schemas.jobs import JobResponse
from app.schemas.projects import WorkspaceResponse
from app.services.geojson_export import GeoJsonExport
from app.services.import_upload import receive_upload
from app.services.jobs import ImportErrorResponse, JobService

router = APIRouter(tags=["GeoJSON jobs"],responses={404:{"description":"Kaynak bulunamadı"},409:{"description":"Durum/revision çakışması"},413:{"description":"Boyut sınırı"},429:{"description":"Kapasite dolu"},507:{"description":"Disk kotası"}})


def service(request):
    return JobService(request.app.state.database,request.app.state.settings)


@router.post("/workspaces/{workspace_id}/imports",response_model=JobResponse,status_code=202,openapi_extra={
    "requestBody":{"required":False,"content":{
        "multipart/form-data":{"schema":{"type":"object","required":["file"],"properties":{"file":{"type":"string","format":"binary"}}}},
        "application/json":{"schema":{"type":"object","maxProperties":0}},
    }}})
async def upload_import(workspace_id: UUID, request: Request, job_id: UUID | None = Query(default=None,alias="jobId"),
                        expected_dataset_id: UUID | None = Query(default=None,alias="expectedDatasetId"),
                        expected_generation_id: UUID | None = Query(default=None,alias="expectedGenerationId"),
                        expected_revision: int | None = Query(default=None,alias="expectedRevision",ge=0)):
    jobs = service(request)
    values = (expected_dataset_id,expected_generation_id,expected_revision)
    if any(value is not None for value in values) and (job_id is not None or any(value is None for value in values)):
        raise ImportErrorResponse("Beklenen dataset/generation/revision birlikte yalnız rezervasyonda gönderilmeli.",422)
    expected = dict(expected_dataset_id=str(expected_dataset_id),expected_generation_id=str(expected_generation_id),expected_revision=expected_revision) if expected_dataset_id is not None else {}
    multipart = request.headers.get("content-type","").lower().startswith("multipart/form-data")
    if not multipart:
        size = 0
        body = bytearray()
        async for chunk in request.stream():
            size += len(chunk)
            if size > 1024: raise ImportErrorResponse("Rezervasyon gövdesi çok büyük.",413)
            body.extend(chunk)
        if job_id is not None or (body and bytes(body).strip() not in (b"{}",b"")):
            raise ImportErrorResponse("Dosyasız istek boş bir rezervasyon olmalı.",422)
        return await run_in_threadpool(jobs.reserve,str(workspace_id),**expected)
    created = job_id is None
    if created:
        job = await run_in_threadpool(jobs.reserve,str(workspace_id),**expected)
        job_id = job.id
    try:
        return await receive_upload(request,jobs,str(job_id),str(workspace_id))
    except BaseException:
        if created:
            current = await run_in_threadpool(jobs.get,str(job_id))
            if current.status=='uploading':
                await run_in_threadpool(jobs.finish,str(job_id),'failed','Yükleme başlatılamadı.')
        raise


@router.get("/jobs/{job_id}",response_model=JobResponse)
def get_job(job_id: UUID, request: Request):
    return service(request).get(str(job_id))


@router.post("/jobs/{job_id}/cancel",response_model=JobResponse)
def cancel_job(job_id: UUID, request: Request):
    return service(request).cancel(str(job_id))


@router.post("/jobs/{job_id}/activate",response_model=WorkspaceResponse)
def activate_job(job_id: UUID, request: Request):
    return service(request).activate(str(job_id))


@router.get("/workspaces/{workspace_id}/export",response_class=StreamingResponse,responses={200:{"content":{"application/geo+json":{}}}})
def export_workspace(workspace_id: UUID, request: Request):
    export = GeoJsonExport(request.app.state.settings,str(workspace_id))
    workspace = export.workspace
    filename = quote(workspace.dataset.name.replace("\r","").replace("\n",""),safe="")
    return StreamingResponse(export.chunks(),media_type="application/geo+json",background=BackgroundTask(export.close),headers={
        "Content-Disposition":f"attachment; filename=workspace.geojson; filename*=UTF-8''{filename}",
        "ETag":f'"{workspace.generation_id}:{workspace.dataset.revision}"',
        "X-Dataset-Id":workspace.active_dataset_id,
        "X-Generation-Id":workspace.generation_id,
        "X-Dataset-Revision":str(workspace.dataset.revision),
    })
