import asyncio
from datetime import timedelta
import io
import json
import os
from pathlib import Path
import tracemalloc
import subprocess
import sys
import time
from uuid import uuid4
import psutil

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select, text

from app.db.models import Dataset, Feature, Job, utc_now
from app.domain.streaming_geojson import stream_collection
from app.services.datasets import DatasetService
from app.services.geojson_export import GeoJsonExport
from app.services.jobs import ImportStopped, JobService
from app.services.projects import ProjectService
from app.workers.import_worker import ImportWorker, ProgressReader, run_import


def point(index=0):
    return {"type":"Feature","id":index,"properties":{"name":"Şırnak 🌍","nested":[True,None,{"keep":1.5}]},
            "geometry":{"type":"Point","coordinates":[37+index*.000001,39,123]},"foreign":{"keep":True}}


def document(features=None,**metadata):
    return {"type":"FeatureCollection","features":features if features is not None else [point()],**metadata}


@pytest.fixture
def import_api(settings,migrated_database,application):
    settings.import_max_bytes = 2*1024*1024
    settings.import_disk_quota_bytes = 64*1024*1024
    settings.import_batch_size = 3
    settings.import_batch_bytes = 1024
    with TestClient(application) as api:
        yield api


@pytest.fixture
def original(import_api,migrated_database):
    workspace = import_api.post('/api/v1/workspaces').json()
    with migrated_database.sessions.begin() as session:
        DatasetService(session).add_feature(workspace['activeDatasetId'],point(99))
    workspace = import_api.get(f"/api/v1/workspaces/{workspace['id']}").json()
    project = import_api.post('/api/v1/projects',json={"workspaceId":workspace['id'],"name":"Önceki",
        "expectedDatasetId":workspace['activeDatasetId'],"expectedGenerationId":workspace['generationId'],"expectedRevision":workspace['dataset']['revision']}).json()
    workspace = import_api.get(f"/api/v1/workspaces/{workspace['id']}").json()
    return workspace,project


def upload(api,workspace,content,filename='data.geojson'):
    reserved = api.post(f"/api/v1/workspaces/{workspace['id']}/imports")
    assert reserved.status_code == 202,reserved.text
    job = reserved.json()
    payload = json.dumps(content,ensure_ascii=False).encode() if isinstance(content,dict) else content
    response = api.post(f"/api/v1/workspaces/{workspace['id']}/imports?jobId={job['id']}",files={'file':(filename,payload,'application/geo+json')})
    return job,response


def execute(database,settings,job_id):
    jobs = JobService(database,settings)
    claim = jobs.claim()
    assert claim and claim[0] == job_id
    run_import(settings,*claim)
    jobs.maintain()
    return jobs.get(job_id)


def assert_original(api,original):
    workspace,project = original
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json() == workspace
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project


def test_upload_process_then_explicit_atomic_activation(import_api,migrated_database,settings,original):
    workspace,project = original
    payload = document([point(1),point(1),{"type":"Feature","properties":None,"geometry":None}],
        category_catalog=[{"name":"Kullanılmayan","subcategories":["Alt"]}],custom={"nested":[1,False,"Türkçe"]},bbox=[0,0,180,90])
    reservation,response = upload(import_api,workspace,payload)
    assert response.status_code == 202,response.text
    assert response.json()['status'] == 'queued'
    result = execute(migrated_database,settings,reservation['id'])
    assert result.status == 'completed' and result.processed_features == 3
    assert result.processed_bytes == result.total_bytes and result.uploaded_bytes == result.total_bytes
    assert_original(import_api,original)
    activated = import_api.post(f"/api/v1/jobs/{result.id}/activate")
    assert activated.status_code == 200,activated.text
    active = activated.json()
    assert active['activeDatasetId'] == result.staging_dataset_id
    assert active['generationId'] != workspace['generationId'] and active['dataset']['revision'] == 0
    assert active['dataset']['count'] == 3 and active['projectId'] == project['id']
    assert import_api.post(f"/api/v1/jobs/{result.id}/activate").json() == active
    exported = import_api.get(f"/api/v1/workspaces/{workspace['id']}/export")
    assert exported.status_code == 200 and exported.headers['content-type'].startswith('application/geo+json')
    output = exported.json()
    assert output['features'] == payload['features']
    assert output['category_catalog'] == payload['category_catalog']
    assert output['custom'] == payload['custom'] and output['bbox'] == payload['bbox']
    assert import_api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert import_api.post(f"/api/v1/jobs/{result.id}/cancel").status_code == 409


def test_direct_upload_without_reservation(import_api,original):
    workspace,_ = original
    response = import_api.post(f"/api/v1/workspaces/{workspace['id']}/imports",files={'file':('safe.json',json.dumps(document()).encode())})
    assert response.status_code == 202 and response.json()['status']=='queued'


def test_many_features_short_batches_and_metadata_after_features(import_api,migrated_database,settings,original):
    workspace,_ = original
    payload = document([point(i) for i in range(2500)],category_catalog=[{"name":"Boş","subcategories":[]}],extra='after')
    job,response = upload(import_api,workspace,payload)
    assert response.status_code == 202
    result = execute(migrated_database,settings,job['id'])
    assert result.status == 'completed',result.error
    assert result.processed_features == 2500 and len(result.warning_samples)<=settings.import_warning_samples
    with migrated_database.sessions() as session:
        dataset = session.get(Dataset,result.staging_dataset_id)
        assert dataset.count == 2500 and dataset.next_ordinal == 2500 and dataset.revision == 0
        assert dataset.metadata_json == {'extra':'after'}


@pytest.mark.parametrize('payload',[
    b'not json',b'{"type":"FeatureCollection","features":[',
    b'{"features":[{"type":"Feature","properties":{},"geometry":null}],"type":"wrong"}',
    b'{"type":"FeatureCollection","features":{}}',
    b'{"type":"FeatureCollection","features":[42]}',
    b'{"type":"FeatureCollection","features":[],"category_catalog":null}',
    b'{"type":"FeatureCollection","features":[],"features":[]}',
    b'{"type":"FeatureCollection","features":[]} trailing',
    b'{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[181,1]}}]}',
])
def test_invalid_files_fail_without_changing_active_or_project(import_api,migrated_database,settings,original,payload):
    job,response = upload(import_api,original[0],payload)
    assert response.status_code == 202
    result = execute(migrated_database,settings,job['id'])
    assert result.status == 'failed' and result.error
    assert result.staging_dataset_id is None and not result.cleanup_pending
    assert_original(import_api,original)


def test_truncated_final_feature_cleans_previously_committed_batches(import_api,migrated_database,settings,original):
    content = b'{"type":"FeatureCollection","features":['+b','.join(json.dumps(point(i)).encode() for i in range(20))+b',{"type":"Feature"'
    job,_ = upload(import_api,original[0],content)
    result = execute(migrated_database,settings,job['id'])
    assert result.status == 'failed' and result.processed_features > 0
    assert result.staging_dataset_id is None
    assert_original(import_api,original)


def test_topology_is_warning_not_silent_repair(import_api,migrated_database,settings,original):
    invalid = {"type":"Feature","id":"bow","properties":{},"geometry":{"type":"Polygon","coordinates":[[[0,0],[2,2],[2,0],[0,2],[0,0]]]}}
    job,_ = upload(import_api,original[0],document([invalid]))
    result = execute(migrated_database,settings,job['id'])
    assert result.status == 'completed' and result.warning_count >= 1
    assert result.invalid_features == 1
    assert result.warning_samples[0]['code'] == 'SELF_INTERSECTION'
    import_api.post(f"/api/v1/jobs/{result.id}/activate")
    assert import_api.get(f"/api/v1/workspaces/{original[0]['id']}/export").json()['features'] == [invalid]


def test_cancel_queued_and_completed_imports(import_api,migrated_database,settings,original):
    for completed in (False,True):
        job,_ = upload(import_api,original[0],document())
        if completed: execute(migrated_database,settings,job['id'])
        assert import_api.post(f"/api/v1/jobs/{job['id']}/cancel").json()['status'] == 'cancelled'
        JobService(migrated_database,settings).maintain()
        assert import_api.post(f"/api/v1/jobs/{job['id']}/activate").status_code == 409
        assert not any(path.exists() for path in JobService(migrated_database,settings).paths(job['id']))
        assert_original(import_api,original)


def test_cancellation_during_processing(import_api,migrated_database,settings,original,monkeypatch):
    job,_ = upload(import_api,original[0],document([point(i) for i in range(20)]))
    original_pulse = JobService.pulse
    def cancel(self,job_id,token,processed):
        original_pulse(self,job_id,token,processed)
        self.cancel(job_id)
    monkeypatch.setattr(JobService,'pulse',cancel)
    result = execute(migrated_database,settings,job['id'])
    assert result.status=='cancelled' and result.staging_dataset_id is None
    assert_original(import_api,original)


def test_restart_recovers_expired_worker_and_cleans_partial_data(import_api,migrated_database,settings,original):
    job,_ = upload(import_api,original[0],document())
    jobs = JobService(migrated_database,settings)
    identifier,token = jobs.claim()
    with migrated_database.sessions.begin() as session:
        staged = Dataset(name='partial',status='staging')
        session.add(staged); session.flush()
        DatasetService(session).append_staging_batch(staged.id,[point()])
        record = session.get(Job,identifier)
        record.staging_dataset_id = staged.id
        record.lease_expires_at = utc_now()-timedelta(seconds=1)
    jobs.maintain()
    result = jobs.get(identifier)
    assert result.status=='failed' and result.staging_dataset_id is None and result.error
    with migrated_database.sessions.begin() as session:
        with pytest.raises(ImportStopped): jobs.owned(session,identifier,token)
    assert_original(import_api,original)


def test_activation_revision_conflict_and_atomic_rollback(import_api,migrated_database,settings,original):
    workspace,_ = original
    job,_ = upload(import_api,workspace,document())
    result = execute(migrated_database,settings,job['id'])
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql("CREATE TRIGGER fail_activate BEFORE UPDATE OF active_dataset_id ON workspaces BEGIN SELECT RAISE(ABORT,'activation probe'); END")
    assert import_api.post(f"/api/v1/jobs/{job['id']}/activate").status_code == 503
    assert_original(import_api,original)
    with migrated_database.sessions() as session:
        assert session.get(Dataset,result.staging_dataset_id).status=='staging'
        assert session.get(Job,result.id).activated_at is None
    with migrated_database.engine.begin() as connection: connection.exec_driver_sql('DROP TRIGGER fail_activate')
    with migrated_database.sessions.begin() as session:
        DatasetService(session).add_feature(workspace['activeDatasetId'],point(3))
    assert import_api.post(f"/api/v1/jobs/{job['id']}/activate").status_code == 409
    assert JobService(migrated_database,settings).get(job['id']).status=='completed'


def test_upload_disk_failure_and_invalid_format_cleanup(import_api,migrated_database,settings,original,monkeypatch):
    job,response = upload(import_api,original[0],b'{}',filename='bad.xlsx')
    assert response.status_code == 415
    assert JobService(migrated_database,settings).get(job['id']).status=='failed'
    def fail(_descriptor): raise OSError('disk write probe')
    monkeypatch.setattr(os,'fsync',fail)
    job,response = upload(import_api,original[0],document())
    assert response.status_code == 507
    assert not any(path.exists() for path in JobService(migrated_database,settings).paths(job['id']))
    assert_original(import_api,original)


def test_quotas_file_limits_and_safe_filename(import_api,migrated_database,settings,original):
    settings.import_max_bytes = 1024
    job,response = upload(import_api,original[0],b'x'*2048)
    assert response.status_code == 413
    assert JobService(migrated_database,settings).get(job['id']).status=='failed'
    job,response = upload(import_api,original[0],document(),filename='../../escape.geojson')
    assert response.status_code == 202 and response.json()['filename']=='escape.geojson'
    assert not (settings.import_directory.parent/'escape.geojson').exists()
    settings.import_disk_quota_bytes = 1024
    assert import_api.post(f"/api/v1/workspaces/{original[0]['id']}/imports").status_code == 507


def test_stream_parser_bounded_reads_and_python_memory(settings,tmp_path):
    path = tmp_path/'many.geojson'
    raw = json.dumps(point(0)|{'properties':{'padding':'x'*1024}}).encode()
    with path.open('wb') as output:
        output.write(b'{"type":"FeatureCollection","features":[')
        for index in range(18000):
            if index: output.write(b',')
            output.write(raw)
        output.write(b'],"custom":{"after":true}}')
    assert path.stat().st_size > 18*1024*1024
    class Guard:
        def __init__(self,source): self.source=source
        def read(self,size=-1):
            assert 0 <= size <= settings.import_chunk_bytes
            return self.source.read(size)
    tracemalloc.start()
    try:
        with path.open('rb') as source:
            reader = ProgressReader(Guard(source),settings.import_chunk_bytes,lambda size:None)
            count = 0
            for kind,value,size in stream_collection(reader,settings):
                if kind=='feature': count += 1
                else: assert value['custom']=={'after':True}
            assert reader.bytes_read==path.stat().st_size and count==18000
        _current,peak = tracemalloc.get_traced_memory()
    finally: tracemalloc.stop()
    assert peak < 8*1024*1024


def test_export_read_snapshot_stays_consistent_during_concurrent_edits(import_api,migrated_database,settings,original):
    workspace,_ = original
    export = GeoJsonExport(settings,workspace['id'])
    with migrated_database.sessions.begin() as session:
        DatasetService(session).add_feature(workspace['activeDatasetId'],point(1))
    output = json.loads(b''.join(export.chunks()))
    assert output['features']==[point(99)] and export.closed
    assert len(import_api.get(f"/api/v1/workspaces/{workspace['id']}/export").json()['features'])==2


def test_separate_worker_process_and_memory_guard(import_api,migrated_database,settings,original):
    job,_ = upload(import_api,original[0],document([point(i) for i in range(10)]))
    worker = ImportWorker(settings)
    try: assert worker.run_once()
    finally: worker.close()
    assert JobService(migrated_database,settings).get(job['id']).status=='completed'
    job,_ = upload(import_api,original[0],document([point(i) for i in range(10)]))
    settings.import_worker_memory_bytes = 1024
    worker = ImportWorker(settings)
    try: assert worker.run_once()
    finally: worker.close()
    result = JobService(migrated_database,settings).get(job['id'])
    assert result.status=='failed' and 'bellek' in result.error and result.peak_rss_bytes>0
    assert_original(import_api,original)


def test_upload_cancel_between_asgi_chunks(import_api,migrated_database,settings,original):
    workspace,_ = original
    jobs = JobService(migrated_database,settings)
    job = jobs.reserve(workspace['id'])
    prefix = b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="data.geojson"\r\nContent-Type: application/json\r\n\r\n'
    chunks=[prefix+b'{"type":',b'"FeatureCollection","features":[]}\r\n--boundary--\r\n']
    async def invoke():
        index=0; sent=[]
        async def receive():
            nonlocal index
            if index==1:
                await asyncio.sleep(.11)
                jobs.cancel(job.id)
            chunk=chunks[index]; index+=1
            return {'type':'http.request','body':chunk,'more_body':index<len(chunks)}
        async def send(message): sent.append(message)
        path=f'/api/v1/workspaces/{workspace["id"]}/imports'
        scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':'POST','scheme':'http',
               'path':path,'raw_path':path.encode(),'query_string':f'jobId={job.id}'.encode(), 'root_path':'',
               'headers':[(b'content-type',b'multipart/form-data; boundary=boundary')], 'client':('test',1),'server':('test',80)}
        await import_api.app(scope,receive,send)
        assert next(message['status'] for message in sent if message['type']=='http.response.start')==409
    asyncio.run(invoke())
    assert jobs.get(job.id).status=='cancelled'
    assert_original(import_api,original)


def test_unknown_job_invalid_uuid_and_wrong_workspace(import_api,original):
    assert import_api.get(f'/api/v1/jobs/{uuid4()}').status_code==404
    assert import_api.get('/api/v1/jobs/not-uuid').status_code==422
    job = import_api.post(f"/api/v1/workspaces/{original[0]['id']}/imports").json()
    other = import_api.post('/api/v1/workspaces').json()
    response = import_api.post(f"/api/v1/workspaces/{other['id']}/imports?jobId={job['id']}",files={'file':('data.json',b'{}')})
    assert response.status_code==409


def test_sqlite_claim_and_upload_limits_are_shared_between_service_instances(import_api,migrated_database,settings,original):
    jobs = JobService(migrated_database,settings)
    other = JobService(migrated_database,settings)
    settings.import_max_uploads=1
    first=jobs.reserve(original[0]['id']); second=jobs.reserve(original[0]['id'])
    token=jobs.begin_upload(first.id,original[0]['id'])
    response=import_api.post(f"/api/v1/workspaces/{original[0]['id']}/imports?jobId={second.id}",files={'file':('data.json',json.dumps(document()).encode())})
    assert response.status_code==429
    jobs.finish(first.id,'failed','test ended',token=token)
    response=import_api.post(f"/api/v1/workspaces/{original[0]['id']}/imports?jobId={second.id}",files={'file':('data.json',json.dumps(document()).encode())})
    assert response.status_code==202
    third,_=upload(import_api,original[0],document())
    settings.import_max_running=1
    claimed=jobs.claim(); assert claimed
    assert other.claim() is None
    jobs.finish(*[claimed[0],'failed','test ended'],token=claimed[1])
    assert other.claim()[0]==third['id']


def test_pending_capacity_and_expired_reservation(import_api,migrated_database,settings,original):
    settings.import_max_pending=1
    jobs=JobService(migrated_database,settings)
    job=jobs.reserve(original[0]['id'])
    assert import_api.post(f"/api/v1/workspaces/{original[0]['id']}/imports").status_code==429
    with migrated_database.sessions.begin() as session:
        session.get(Job,job.id).lease_expires_at=utc_now()-timedelta(seconds=1)
    jobs.maintain()
    assert jobs.get(job.id).status=='failed'
    assert import_api.post(f"/api/v1/workspaces/{original[0]['id']}/imports").status_code==202


@pytest.mark.parametrize('setting,value,payload',[
    ('import_max_feature_bytes',128,document()),
    ('import_max_metadata_bytes',128,document(custom='x'*256)),
    ('import_max_features',1,document([point(),point()])),
    ('import_max_vertices',1,document([point(),point()])),
    ('import_max_feature_nodes',10,document()),
    ('import_max_category_chars',10,document([point()|{'properties':{'ana_kategori':'x'*20}}])),
    ('import_max_category_chars',10,document(category_catalog=[{'name':'x'*20,'subcategories':[]}])),
])
def test_import_limits_are_independent_of_sync_validation_limits(import_api,migrated_database,settings,original,setting,value,payload):
    setattr(settings,setting,value)
    job,_=upload(import_api,original[0],payload)
    result=execute(migrated_database,settings,job['id'])
    assert result.status=='failed' and result.error
    assert_original(import_api,original)


def test_large_integer_id_dotted_keys_and_metadata_survive_save_open(import_api,migrated_database,settings,original):
    item=point(); item['id']=2**90; item['properties']['a.b']={'features.item':[1,2.5,False]}
    payload=document([item],**{'features.item':{'nested':True},'custom':['unknown',{'keep':42}]})
    job,_=upload(import_api,original[0],payload)
    result=execute(migrated_database,settings,job['id'])
    assert result.status=='completed',result.error
    active=import_api.post(f"/api/v1/jobs/{job['id']}/activate").json()
    project=original[1]
    saved=import_api.put(f"/api/v1/projects/{project['id']}/content",json={'workspaceId':active['id'],'expectedVersion':1,
        'expectedDatasetId':active['activeDatasetId'],'expectedGenerationId':active['generationId'],'expectedRevision':0})
    assert saved.status_code==200,saved.text
    opened=import_api.post('/api/v1/workspaces',json={'projectId':project['id'],'expectedProjectVersion':2}).json()
    exported=import_api.get(f"/api/v1/workspaces/{opened['id']}/export").json()
    assert exported['features']==payload['features']
    assert exported['features.item']==payload['features.item'] and exported['custom']==payload['custom']


def test_activation_defers_old_dataset_cleanup(import_api,migrated_database,settings,original):
    workspace,project=original
    job,_=upload(import_api,workspace,document())
    execute(migrated_database,settings,job['id'])
    assert import_api.post(f"/api/v1/jobs/{job['id']}/activate").status_code==200
    with migrated_database.sessions() as session:
        assert session.get(Dataset,workspace['activeDatasetId']) is not None
    JobService(migrated_database,settings).maintain()
    with migrated_database.sessions() as session:
        assert session.get(Dataset,workspace['activeDatasetId']) is None
        assert session.get(Dataset,project['savedDatasetId']) is not None


def test_worker_stall_budget_and_graceful_stop_preserve_old_data(import_api,migrated_database,settings,original):
    job,_=upload(import_api,original[0],document([point(i) for i in range(10)]))
    settings.import_stall_seconds=.001
    worker=ImportWorker(settings)
    try: worker.run_once()
    finally: worker.close()
    result=JobService(migrated_database,settings).get(job['id'])
    assert result.status=='failed' and 'ilerleme' in result.error
    settings.import_stall_seconds=30
    job,_=upload(import_api,original[0],document())
    worker=ImportWorker(settings); worker.stopping=True
    try: worker.run_once()
    finally: worker.close()
    assert JobService(migrated_database,settings).get(job['id']).status=='failed'
    assert_original(import_api,original)


def test_api_restart_marks_expired_jobs_but_preserves_live_worker_leases(import_api,migrated_database,settings,original):
    from app.main import create_app
    jobs=JobService(migrated_database,settings)
    stale,_=upload(import_api,original[0],document())
    stale_id,stale_token=jobs.claim()
    live,_=upload(import_api,original[0],document())
    live_id,live_token=jobs.claim()
    with migrated_database.sessions.begin() as session:
        session.get(Job,stale_id).lease_expires_at=utc_now()-timedelta(seconds=1)
    with TestClient(create_app(settings)):
        assert jobs.get(stale_id).status=='failed'
        assert jobs.get(stale_id).cleanup_pending
        assert jobs.get(live_id).status=='running'
    jobs.maintain()
    jobs.finish(live_id,'failed','test complete',token=live_token)
    assert_original(import_api,original)


def test_jobs_swagger_upload_and_streaming_media_type(import_api):
    schema=import_api.get('/openapi.json').json()['paths']
    upload_schema=schema['/api/v1/workspaces/{workspace_id}/imports']['post']
    assert upload_schema['requestBody']['content']['multipart/form-data']['schema']['properties']['file']['format']=='binary'
    assert '202' in upload_schema['responses']
    content=schema['/api/v1/workspaces/{workspace_id}/export']['get']['responses']['200']['content']
    assert set(content)=={'application/geo+json'}


def test_sigkill_restart_stops_orphan_and_recovers_partial_job(import_api,migrated_database,settings,original):
    from app.core.config import BACKEND_DIR
    job,_=upload(import_api,original[0],document([point(index) for index in range(3000)]))
    env=os.environ.copy()
    env.update(GEOJSON_DATABASE_PATH=str(settings.database_path),GEOJSON_IMPORT_BATCH_SIZE='3',GEOJSON_IMPORT_LEASE_SECONDS='1')
    coordinator=subprocess.Popen([sys.executable,'-m','app.workers.import_worker','--once'],cwd=BACKEND_DIR,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    child=None
    try:
        jobs=JobService(migrated_database,settings)
        for _ in range(150):
            current=jobs.get(job['id'])
            if current.status=='running' and current.staging_dataset_id:
                children=psutil.Process(coordinator.pid).children()
                child=next((process for process in children if any('spawn_main' in arg for arg in process.cmdline())),None)
                if child is not None: break
            time.sleep(.02)
        assert child is not None
        coordinator.kill(); coordinator.wait(timeout=5)
        def alive():
            try: return child.is_running() and child.status()!=psutil.STATUS_ZOMBIE
            except psutil.NoSuchProcess: return False
        for _ in range(100):
            if not alive(): break
            time.sleep(.02)
        assert not alive(),'Processing child remained orphaned after coordinator SIGKILL'
        time.sleep(1.2)
        jobs.maintain()
        assert jobs.get(job['id']).status=='failed'
        assert jobs.get(job['id']).staging_dataset_id is None
        assert_original(import_api,original)
    finally:
        if coordinator.poll() is None: coordinator.kill(); coordinator.wait(timeout=5)
        if child is not None:
            try:
                if child.is_running() and child.status()!=psutil.STATUS_ZOMBIE: child.kill()
            except psutil.NoSuchProcess: pass
