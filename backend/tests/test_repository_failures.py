"""Transport failures must leave both aggregate data and spatial indexes intact."""
import json
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text

from app.services.repository import RepositoryService


@pytest.fixture
def api(migrated_database,application):
    with TestClient(application,raise_server_exceptions=False) as client:
        yield client


def workspace(api):
    result=api.post('/api/v1/workspaces').json()
    state={'expectedDatasetId':result['activeDatasetId'],'expectedGenerationId':result['generationId'],
           'expectedRevision':result['dataset']['revision']}
    return f"/api/v1/workspaces/{result['id']}",state


def feature():
    return {'type':'Feature','id':'external','properties':{'keep':True},
            'geometry':{'type':'Point','coordinates':[29,41,15]}}


def test_unexpected_error_returns_safe_json_and_rolls_back_mutation(api,migrated_database,monkeypatch):
    base,state=workspace(api)
    def fail(*args,**kwargs):
        raise RuntimeError('private implementation detail')
    with monkeypatch.context() as patch:
        patch.setattr(RepositoryService,'context',fail)
        response=api.post(base+'/mutations',json={**state,'feature':feature()})
    assert response.status_code==500
    assert response.json()=={'detail':'Beklenmeyen sunucu hatası.'}
    assert api.get(base).json()['dataset']['revision']==0
    with migrated_database.engine.connect() as connection:
        assert connection.execute(text('SELECT count(*) FROM features')).scalar_one()==0
        assert connection.execute(text('SELECT count(*) FROM feature_rtree')).scalar_one()==0


def test_raw_body_size_counts_received_chunks_before_validation(api,application):
    base,state=workspace(api)
    application.state.settings.repository_max_feature_bytes=128
    # No Content-Length is required for enforcing the actual received byte cap.
    def chunks():
        for _ in range(20):
            yield b' '*1024
    response=api.post(base+'/mutations',content=chunks(),headers={'Content-Type':'application/json'})
    assert response.status_code==413
    assert api.get(base).json()['dataset']['revision']==0


def test_import_reservation_requires_complete_current_context(api,migrated_database):
    base,state=workspace(api)
    partial=api.post(base+'/imports',params={'expectedRevision':0},json={})
    assert partial.status_code==422
    stale=api.post(base+'/imports',params={**state,'expectedDatasetId':str(uuid4())},json={})
    assert stale.status_code==409
    with migrated_database.engine.connect() as connection:
        assert connection.execute(text('SELECT count(*) FROM jobs')).scalar_one()==0
    reserved=api.post(base+'/imports',params=state,json={})
    assert reserved.status_code==202
    job=reserved.json()
    assert job['initialDatasetId']==state['expectedDatasetId']
    assert job['initialGenerationId']==state['expectedGenerationId']
    assert job['initialRevision']==state['expectedRevision']
    assert api.post(base+'/imports',params={**state,'jobId':job['id']},json={}).status_code==422
    assert api.post(f"/api/v1/jobs/{job['id']}/cancel").status_code==200


def test_trimmed_category_length_matches_local_catalog(api):
    base,state=workspace(api)
    response=api.post(base+'/categories',json={**state,'name':' '*100+'IŞIK'+' '*100})
    assert response.status_code==200
    assert api.get(base+'/categories').json()==[{'name':'IŞIK','subcategories':[]}]


def test_export_state_headers_match_the_read_snapshot(api):
    base,state=workspace(api)
    response=api.get(base+'/export')
    assert response.status_code==200
    assert response.headers['x-dataset-id']==state['expectedDatasetId']
    assert response.headers['x-generation-id']==state['expectedGenerationId']
    assert response.headers['x-dataset-revision']=='0'
    assert json.loads(response.content)['features']==[]
