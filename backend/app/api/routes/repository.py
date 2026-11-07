from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from pydantic import FiniteFloat

from app.db.session import get_session
from app.schemas.datasets import CategoryGroup, CategoryMutationResult, FeaturePage, FeatureRecord, MutationResult, ViewportResult
from app.schemas.projects import WorkspaceResponse, WorkspaceState
from app.schemas.repository import AddCategoryRequest, MutationRequest
from app.services.geometry_validation import GeometryValidationError, strict_json_loads
from app.services.repository import RepositoryInputError, RepositoryService
from app.services.spatial import SpatialService


class JsonRequest(Request):
    async def json(self):
        try: return strict_json_loads(await self.body())
        except GeometryValidationError as error: raise HTTPException(status_code=422,detail=error.detail) from error


class LimitedRoute(APIRoute):
    def get_route_handler(self):
        original=super().get_route_handler()
        async def handle(request):
            if request.method!='POST': return await original(request)
            limit=request.app.state.settings.repository_max_feature_bytes+8192
            received=0
            async def receive():
                nonlocal received
                message=await request.receive()
                received+=len(message.get('body',b''))
                if received>limit: raise HTTPException(status_code=413,detail='İstek gövdesi boyut sınırı aşıldı.')
                return message
            return await original(JsonRequest(request.scope,receive=receive))
        return handle


router=APIRouter(prefix='/workspaces',tags=['GeoJsonRepository'],route_class=LimitedRoute,responses={
    404:{'description':'Workspace veya Feature bulunamadı'},409:{'description':'Workspace/revision değişti'},
    413:{'description':'Feature veya istek sınırı aşıldı'},422:{'description':'Geçersiz istek'},500:{'description':'Beklenmeyen sunucu hatası'},
})
SessionDependency=Annotated[Session,Depends(get_session)]


def service(request,session): return RepositoryService(session,request.app.state.settings)


def context_headers(response,context):
    response.headers['X-Dataset-Id']=context.active_dataset_id
    response.headers['X-Generation-Id']=context.generation_id
    response.headers['X-Dataset-Revision']=str(context.dataset.revision)
    response.headers['ETag']=f'"{context.active_dataset_id}:{context.generation_id}:{context.dataset.revision}"'


def expected(payload):
    return dict(expected_dataset_id=str(payload.expected_dataset_id),expected_generation_id=str(payload.expected_generation_id),expected_revision=payload.expected_revision)


@router.post('/{workspace_id}/empty',response_model=WorkspaceResponse)
def create_empty(workspace_id: UUID,payload: WorkspaceState,request: Request,response: Response,session: SessionDependency):
    with session.begin(): result=service(request,session).create_empty(str(workspace_id),**expected(payload))
    context_headers(response,result)
    return result


@router.get('/{workspace_id}/viewport',response_model=ViewportResult)
def viewport(workspace_id: UUID,request: Request,response: Response,session: SessionDependency,
             bounds: Annotated[list[FiniteFloat],Query(min_length=4,max_length=4)],
             tolerance: Annotated[float,Query(ge=0,allow_inf_nan=False)]=0,
             limit: int=2500):
    repository=service(request,session); context=repository.context(str(workspace_id))
    if not (-180<=bounds[0]<=bounds[2]<=180 and -90<=bounds[1]<=bounds[3]<=90):
        raise RepositoryInputError('bounds [minLon,minLat,maxLon,maxLat] WGS84 sınırlarında ve sıralı olmalı.')
    result=SpatialService(session).query(context.active_dataset_id,bounds,tolerance,limit,
        max_source_bytes=request.app.state.settings.repository_max_viewport_bytes,
        max_simplification_steps=request.app.state.settings.repository_max_simplification_steps)
    context_headers(response,context)
    return result


@router.get('/{workspace_id}/features',response_model=FeaturePage)
def list_features(workspace_id: UUID,request: Request,response: Response,session: SessionDependency,
                  search: str='',offset: Annotated[int,Query(ge=0)]=0,limit: Annotated[int,Query(ge=1)]=50):
    repository=service(request,session); context=repository.context(str(workspace_id))
    result=repository.datasets.list_features(context.active_dataset_id,search,offset,min(limit,100))
    context_headers(response,context)
    return result


@router.get('/{workspace_id}/features/{feature_id}',response_model=FeatureRecord)
def get_feature(workspace_id: UUID,feature_id: str,request: Request,response: Response,session: SessionDependency):
    repository=service(request,session); context=repository.context(str(workspace_id))
    try: result=repository.datasets.get_feature(context.active_dataset_id,feature_id)
    except (ValueError,TypeError) as error:
        from app.services.errors import NotFoundError
        if isinstance(error,NotFoundError): raise
        raise RepositoryInputError(str(error)) from error
    context_headers(response,context)
    return result


@router.post('/{workspace_id}/mutations',response_model=MutationResult)
def mutate(workspace_id: UUID,payload: MutationRequest,request: Request,response: Response,session: SessionDependency):
    repository=service(request,session)
    with session.begin():
        result=repository.mutate(str(workspace_id),id=payload.id,feature=payload.feature,**expected(payload))
        context=repository.context(str(workspace_id))
    context_headers(response,context)
    return result


@router.delete('/{workspace_id}/features/{feature_id}',response_model=MutationResult)
def delete_feature(workspace_id: UUID,feature_id: str,request: Request,response: Response,session: SessionDependency,
                   expected_dataset_id: UUID=Query(alias='expectedDatasetId'),
                   expected_generation_id: UUID=Query(alias='expectedGenerationId'),
                   expected_revision: Annotated[int,Query(alias='expectedRevision',ge=0)]=...):
    repository=service(request,session)
    with session.begin():
        result=repository.mutate(str(workspace_id),id=feature_id,feature=None,
            expected_dataset_id=str(expected_dataset_id),expected_generation_id=str(expected_generation_id),expected_revision=expected_revision)
        context=repository.context(str(workspace_id))
    context_headers(response,context)
    return result


@router.get('/{workspace_id}/categories',response_model=list[CategoryGroup])
def categories(workspace_id: UUID,request: Request,response: Response,session: SessionDependency):
    repository=service(request,session); context=repository.context(str(workspace_id))
    result=repository.datasets.categories(context.active_dataset_id)
    context_headers(response,context)
    return result


@router.post('/{workspace_id}/categories',response_model=CategoryMutationResult)
def add_category(workspace_id: UUID,payload: AddCategoryRequest,request: Request,response: Response,session: SessionDependency):
    repository=service(request,session)
    with session.begin():
        result=repository.add_category(str(workspace_id),payload.name,payload.parent,**expected(payload))
        context=repository.context(str(workspace_id))
    context_headers(response,context)
    return result
