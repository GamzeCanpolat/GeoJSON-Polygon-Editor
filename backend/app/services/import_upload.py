import asyncio
import os
from pathlib import Path
import time
import anyio

from fastapi import Request, UploadFile
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException

from app.services.jobs import ImportErrorResponse, ImportStopped, JobService


async def receive_upload(request: Request, jobs: JobService, job_id: str, workspace_id: str):
    settings = jobs.settings
    token = await run_in_threadpool(jobs.begin_upload,job_id,workspace_id)
    failure = None
    received = 0
    last_pulse = 0.0
    deadline = time.monotonic()+settings.import_upload_timeout_seconds
    part,ready = jobs.paths(job_id)
    async def receive():
        nonlocal failure,received,last_pulse
        try:
            remaining = deadline-time.monotonic()
            if remaining <= 0: raise TimeoutError
            message = await asyncio.wait_for(request.receive(),remaining)
            if message["type"] == "http.disconnect":
                raise ImportStopped("Yükleme bağlantısı kapandı.")
            received += len(message.get("body",b""))
            if received > settings.import_max_bytes+1024*1024:
                raise ImportErrorResponse("Dosya boyutu sınırı aşıldı.",413)
            if time.monotonic()-last_pulse >= 0.1:
                await run_in_threadpool(jobs.upload_progress,job_id,token,received=received)
                last_pulse = time.monotonic()
            return message
        except (ImportStopped,ImportErrorResponse,TimeoutError) as error:
            failure = error
            # Starlette closes its partially spooled files on this exception.
            raise MultiPartException("Yükleme durduruldu.") from error
    limited = Request(request.scope,receive=receive)
    try:
        header = request.headers.get("content-length")
        if header and (int(header)<0 or int(header)>settings.import_max_bytes+1024*1024):
            raise ImportErrorResponse("Dosya boyutu sınırı aşıldı.",413)
        async with limited.form(max_files=1,max_fields=0) as form:
            item = form.get("file")
            if not isinstance(item,StarletteUploadFile) or len(form)!=1:
                raise ImportErrorResponse("Tek bir file alanı gerekli.",422)
            file: UploadFile = item
            filename = Path((file.filename or "upload.geojson").replace("\\","/")).name[:255]
            if Path(filename).suffix.lower() not in (".geojson",".json"):
                raise ImportErrorResponse("Yalnızca .geojson veya .json dosyası destekleniyor.",415)
            if file.size is not None and file.size > settings.import_max_bytes:
                raise ImportErrorResponse("Dosya boyutu sınırı aşıldı.",413)
            await run_in_threadpool(jobs.upload_progress,job_id,token,filename=filename,total=file.size or 0)
            part.parent.mkdir(parents=True,exist_ok=True)
            descriptor = os.open(part,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            total = 0
            with os.fdopen(descriptor,"wb") as output:
                while chunk := await file.read(settings.import_chunk_bytes):
                    total += len(chunk)
                    if total > settings.import_max_bytes: raise ImportErrorResponse("Dosya boyutu sınırı aşıldı.",413)
                    if time.monotonic()>deadline: raise TimeoutError
                    if total // (4*1024*1024) != (total-len(chunk)) // (4*1024*1024):
                        await run_in_threadpool(jobs.ensure_disk,extra=len(chunk)*2)
                    await run_in_threadpool(jobs.upload_progress,job_id,token,uploaded=total)
                    await run_in_threadpool(output.write,chunk)
                await run_in_threadpool(output.flush)
                await run_in_threadpool(os.fsync,output.fileno())
            await run_in_threadpool(os.replace,part,ready)
            return await run_in_threadpool(jobs.queue,job_id,token,total)
    except BaseException as caught:
        error = failure or caught
        cancelled = isinstance(error,(ImportStopped,asyncio.CancelledError))
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(jobs.finish,job_id,"cancelled" if cancelled else "failed",str(error) or "Yükleme kesildi.",token=token)
        if isinstance(error,ImportErrorResponse): raise error
        if isinstance(error,ImportStopped): raise ImportErrorResponse(str(error),409) from error
        if isinstance(error,TimeoutError): raise ImportErrorResponse("Yükleme süre sınırı aşıldı.",408) from error
        if isinstance(error,OSError): raise ImportErrorResponse("Dosya diske yazılamadı.",507) from error
        if isinstance(error,(HTTPException,MultiPartException,ValueError)):
            raise ImportErrorResponse("Multipart yükleme biçimi geçersiz.",422) from error
        raise
