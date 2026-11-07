from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.projects import router as projects_router
from app.api.routes.workspaces import router as workspaces_router
from app.api.routes.geometry import router as geometry_router
from app.api.routes.imports import router as imports_router
from app.api.routes.repository import router as repository_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health_router)
api_router.include_router(projects_router)
api_router.include_router(workspaces_router)
api_router.include_router(geometry_router)
api_router.include_router(imports_router)
api_router.include_router(repository_router)
