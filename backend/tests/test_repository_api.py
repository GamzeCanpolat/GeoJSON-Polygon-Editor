"""HTTP compatibility checks for the GeoJsonRepository port; no frontend edits."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text

from app.services.datasets import DatasetService
from app.services.jobs import JobService
from app.workers.import_worker import run_import


@pytest.fixture
def repository_api(migrated_database, application):
    with TestClient(application) as client:
        yield client


def new_workspace(api):
    response = api.post('/api/v1/workspaces')
    assert response.status_code == 201, response.text
    return response.json()


def state(workspace):
    return {'expectedDatasetId': workspace['activeDatasetId'],
            'expectedGenerationId': workspace['generationId'],
            'expectedRevision': workspace['dataset']['revision']}


def current(api, workspace):
    response = api.get(f"/api/v1/workspaces/{workspace['id']}")
    assert response.status_code == 200, response.text
    return response.json()


def point(x=37, y=39, *, external_id='outside', name='Alan', z=123):
    return {'type': 'Feature', 'id': external_id, 'properties': {'name': name, 'foreign': {'keep': [True, None, 1.5]}},
            'geometry': {'type': 'Point', 'coordinates': [x, y, z]}, 'foreign': {'keep': True}}


def polygon():
    return {'type': 'Feature', 'id': 7, 'properties': {'name': 'Polygon', 'ana_kategori': 'Arazi', 'alt_kategori': 'Park'},
            'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0, 10], [4, 0, 11], [4, 4, 12], [0, 4, 13], [0, 0, 10]]]}}


def mutate(api, workspace, feature, internal_id=None):
    payload = {'feature': feature, **state(workspace)}
    if internal_id is not None:
        payload['id'] = internal_id
    response = api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def viewport(api, workspace, bounds=(-180, -90, 180, 90), tolerance=0, limit=2500):
    params = [('bounds', value) for value in bounds] + [('tolerance', tolerance), ('limit', limit)]
    return api.get(f"/api/v1/workspaces/{workspace['id']}/viewport", params=params)


def index_count(database, dataset_id):
    with database.engine.connect() as connection:
        return connection.execute(text('SELECT count(*) FROM feature_rtree r JOIN features f ON f.id=r.id WHERE f.dataset_id=:id'), {'id': dataset_id}).scalar_one()


def test_create_empty_workspace_and_contract_shapes(repository_api):
    workspace = new_workspace(repository_api)
    assert workspace['dataset'] == {'name': 'Adsız çalışma.geojson', 'count': 0, 'vertices': 0,
                                    'bounds': None, 'sourceBytes': 0, 'revision': 0}
    base = f"/api/v1/workspaces/{workspace['id']}"
    assert repository_api.get(base + '/features').json() == {'items': [], 'total': 0}
    assert repository_api.get(base + '/categories').json() == []
    assert viewport(repository_api, workspace).json() == {'records': [], 'matched': 0, 'limited': False}


def test_feature_add_get_preserves_ids_properties_z_and_foreign_members(repository_api, migrated_database):
    workspace = new_workspace(repository_api)
    original = point(external_id='duplicate')
    result = mutate(repository_api, workspace, original)
    assert set(result) == {'id', 'record', 'dataset'}
    assert result['id'] == f"{workspace['generationId']}:0"
    assert result['record']['feature'] == original
    assert set(result['record']) == {'summary', 'feature'}
    assert set(result['record']['summary']) == {'id', 'label', 'geometryType', 'vertices', 'bounds'}
    assert result['record']['summary']['geometryType'] == 'Point'
    assert result['dataset']['revision'] == 1
    assert result['dataset']['bounds'] == [37, 39, 37, 39]
    response = repository_api.get(f"/api/v1/workspaces/{workspace['id']}/features/{result['id']}")
    assert response.status_code == 200 and response.json() == result['record']
    workspace = current(repository_api, workspace)
    second = mutate(repository_api, workspace, original)
    assert second['id'] != result['id'] and second['record']['feature']['id'] == original['id']
    assert index_count(migrated_database, workspace['activeDatasetId']) == 2


def test_geometry_update_delete_restore_and_rtree_are_atomic(repository_api, migrated_database):
    workspace = new_workspace(repository_api)
    added = mutate(repository_api, workspace, point())
    workspace = current(repository_api, workspace)
    changed = deepcopy(added['record']['feature'])
    changed['geometry']['coordinates'] = [10, 20, 456]
    changed['bbox'] = [0, 0, 0, 0]
    changed['geometry']['bbox'] = [0, 0, 0, 0]
    updated = mutate(repository_api, workspace, changed, added['id'])
    assert updated['id'] == added['id'] and updated['dataset']['revision'] == 2
    assert 'bbox' not in updated['record']['feature'] and 'bbox' not in updated['record']['feature']['geometry']
    assert viewport(repository_api, workspace, (36, 38, 38, 40)).json()['matched'] == 0
    assert viewport(repository_api, workspace, (9, 19, 11, 21)).json()['matched'] == 1
    workspace = current(repository_api, workspace)
    deleted = repository_api.delete(f"/api/v1/workspaces/{workspace['id']}/features/{added['id']}", params=state(workspace))
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {'id': added['id'], 'record': None,
                              'dataset': {**updated['dataset'], 'count': 0, 'vertices': 0, 'bounds': None, 'revision': 3}}
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0
    assert repository_api.get(f"/api/v1/workspaces/{workspace['id']}/features/{added['id']}").status_code == 404
    workspace = current(repository_api, workspace)
    restored = mutate(repository_api, workspace, updated['record']['feature'], added['id'])
    assert restored['id'] == added['id'] and restored['dataset']['revision'] == 4
    assert index_count(migrated_database, workspace['activeDatasetId']) == 1
    workspace = current(repository_api, workspace)
    another = mutate(repository_api, workspace, point())
    assert another['id'].endswith(':1')


def test_null_geometry_is_live_but_not_spatially_indexed(repository_api, migrated_database):
    workspace = new_workspace(repository_api)
    original = {'type': 'Feature', 'properties': None, 'geometry': None}
    record = mutate(repository_api, workspace, original)
    assert record['dataset']['count'] == 1 and record['dataset']['vertices'] == 0
    assert record['record']['summary']['bounds'] is None
    assert repository_api.get(f"/api/v1/workspaces/{workspace['id']}/features").json()['total'] == 1
    assert viewport(repository_api, workspace).json()['matched'] == 0
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0
    workspace = current(repository_api, workspace)
    mutate(repository_api, workspace, point(), record['id'])
    assert index_count(migrated_database, workspace['activeDatasetId']) == 1
    workspace = current(repository_api, workspace)
    mutate(repository_api, workspace, original, record['id'])
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0


@pytest.mark.parametrize('field', ['expectedDatasetId', 'expectedGenerationId', 'expectedRevision'])
def test_stale_write_context_is_409_without_any_data_or_revision_change(repository_api, migrated_database, field):
    workspace = new_workspace(repository_api)
    bad_state = state(workspace)
    bad_state[field] = 1 if field == 'expectedRevision' else str(uuid4())
    response = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", json={'feature': point(), **bad_state})
    assert response.status_code == 409, response.text
    assert current(repository_api, workspace) == workspace
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0


def test_parallel_mutations_with_same_revision_allow_only_one_write(repository_api, migrated_database):
    workspace = new_workspace(repository_api)
    payload = {'feature': point(), **state(workspace)}
    def save(_):
        return repository_api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(save, range(2))) == [200, 409]
    assert current(repository_api, workspace)['dataset']['revision'] == 1
    assert index_count(migrated_database, workspace['activeDatasetId']) == 1


def test_feature_list_search_pagination_and_dataset_scope(repository_api):
    workspace = new_workspace(repository_api)
    ids = []
    for name in ('IĞDIR', 'İSTANBUL', 'Park', 'Park 2'):
        result = mutate(repository_api, workspace, point(name=name))
        ids.append(result['id'])
        workspace = current(repository_api, workspace)
    base = f"/api/v1/workspaces/{workspace['id']}"
    page = repository_api.get(base + '/features', params={'search': 'park', 'offset': 1, 'limit': 1}).json()
    assert page['total'] == 2 and [item['id'] for item in page['items']] == [ids[3]]
    assert all('feature' not in item for item in page['items'])
    assert repository_api.get(base + '/features', params={'search': 'ığdır'}).json()['items'][0]['id'] == ids[0]
    assert repository_api.get(base + '/features', params={'search': 'istanbul'}).json()['items'][0]['id'] == ids[1]
    assert repository_api.get(base + '/features', params={'limit': 1000}).json()['total'] == 4
    other = new_workspace(repository_api)
    assert repository_api.get(f"/api/v1/workspaces/{other['id']}/features").json()['total'] == 0
    wrong = repository_api.get(f"/api/v1/workspaces/{other['id']}/features/{ids[0]}")
    assert wrong.status_code == 422


def test_viewport_uses_bbox_overlap_total_limit_and_dataset_scope(repository_api):
    workspace = new_workspace(repository_api)
    # The viewport lies inside the polygon's hole. RBush-compatible semantics
    # intentionally match the bounding box, not exact geometry intersection.
    area = polygon()
    area['geometry']['coordinates'].append([[1, 1, 0], [1, 3, 0], [3, 3, 0], [3, 1, 0], [1, 1, 0]])
    mutate(repository_api, workspace, area)
    workspace = current(repository_api, workspace)
    mutate(repository_api, workspace, point(2, 2))
    workspace = current(repository_api, workspace)
    mutate(repository_api, workspace, point(40, 40))
    response = viewport(repository_api, workspace, (1.5, 1.5, 2.5, 2.5), limit=1)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {'records', 'matched', 'limited'}
    assert body['matched'] == 2 and body['limited'] is True and len(body['records']) == 1
    assert viewport(repository_api, workspace, (1.5, 1.5, 2.5, 2.5), limit=50000).json()['matched'] == 2
    assert viewport(repository_api, new_workspace(repository_api)).json()['matched'] == 0


def test_rtree_float_rounding_is_refined_against_original_bounds(repository_api):
    workspace = new_workspace(repository_api)
    mutate(repository_api, workspace, point(1.00000001, 2))
    assert viewport(repository_api, workspace, (0, 1, 1, 3)).json() == {'records': [], 'matched': 0, 'limited': False}
    assert viewport(repository_api, workspace, (1.00000001, 2, 1.00000001, 2)).json()['matched'] == 1


def test_preview_simplification_keeps_z_and_never_changes_get_or_export(repository_api):
    workspace = new_workspace(repository_api)
    original = {'type': 'Feature', 'id': 'line', 'properties': {'custom': {'keep': True}},
                'geometry': {'type': 'LineString', 'coordinates': [[index / 10, 1, index + 100] for index in range(30)]}}
    result = mutate(repository_api, workspace, original)
    simplified = viewport(repository_api, workspace, (-1, -1, 4, 4), tolerance=.1).json()['records'][0]
    assert len(simplified['feature']['geometry']['coordinates']) < len(original['geometry']['coordinates'])
    assert all(tuple(position) in {tuple(point) for point in original['geometry']['coordinates']} for position in simplified['feature']['geometry']['coordinates'])
    assert simplified['summary']['vertices'] == len(original['geometry']['coordinates'])
    assert repository_api.get(f"/api/v1/workspaces/{workspace['id']}/features/{result['id']}").json()['feature'] == original
    assert repository_api.get(f"/api/v1/workspaces/{workspace['id']}/export").json()['features'] == [original]


def test_categories_turkish_names_unused_catalog_and_revision(repository_api):
    workspace = new_workspace(repository_api)
    base = f"/api/v1/workspaces/{workspace['id']}"
    main = repository_api.post(base + '/categories', json={'name': ' IĞDIR ', **state(workspace)})
    assert main.status_code == 200, main.text
    assert set(main.json()) == {'catalog', 'dataset'} and main.json()['dataset']['revision'] == 1
    workspace = current(repository_api, workspace)
    child = repository_api.post(base + '/categories', json={'name': ' İLÇE ', 'parent': 'ığdır', **state(workspace)})
    assert child.status_code == 200 and child.json()['dataset']['revision'] == 2
    workspace = current(repository_api, workspace)
    duplicate = repository_api.post(base + '/categories', json={'name': 'ığdır', **state(workspace)})
    assert duplicate.status_code == 422
    assert current(repository_api, workspace) == workspace
    assert repository_api.get(base + '/categories').json() == [{'name': 'IĞDIR', 'subcategories': ['İLÇE']}]
    assert repository_api.get(base + '/export').json()['category_catalog'] == [{'name': 'IĞDIR', 'subcategories': ['İLÇE']}]


def test_empty_resets_generation_and_detaches_project_without_changing_snapshot(repository_api):
    workspace = new_workspace(repository_api)
    mutate(repository_api, workspace, point())
    workspace = current(repository_api, workspace)
    project = repository_api.post('/api/v1/projects', json={'workspaceId': workspace['id'], 'name': 'Keep', **state(workspace)}).json()
    reset = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/empty", json=state(workspace))
    assert reset.status_code == 200, reset.text
    blank = reset.json()
    assert blank['id'] == workspace['id'] and blank['projectId'] is None
    assert blank['generationId'] != workspace['generationId']
    assert blank['dataset']['revision'] == 0 and blank['dataset']['count'] == 0
    assert repository_api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert repository_api.post(f"/api/v1/workspaces/{workspace['id']}/empty", json=state(workspace)).status_code == 409


def test_bulk_import_and_snapshot_clones_are_spatially_indexed(repository_api, migrated_database, settings):
    workspace = new_workspace(repository_api)
    payload = {'type': 'FeatureCollection', 'features': [polygon(), point(2, 2), {'type': 'Feature', 'properties': None, 'geometry': None}]}
    response = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/imports", files={'file': ('data.geojson', json.dumps(payload).encode())})
    assert response.status_code == 202, response.text
    job_id = response.json()['id']
    jobs = JobService(migrated_database, settings)
    claimed = jobs.claim()
    assert claimed and claimed[0] == job_id
    run_import(settings, *claimed)
    assert jobs.get(job_id).status == 'completed'
    assert index_count(migrated_database, jobs.get(job_id).staging_dataset_id) == 2
    activated = repository_api.post(f'/api/v1/jobs/{job_id}/activate')
    assert activated.status_code == 200
    workspace = activated.json()
    assert viewport(repository_api, workspace, (1.5, 1.5, 2.5, 2.5)).json()['matched'] == 2
    project = repository_api.post('/api/v1/projects', json={'workspaceId': workspace['id'], 'name': 'Clone', **state(workspace)}).json()
    assert index_count(migrated_database, project['savedDatasetId']) == 2
    opened = repository_api.post('/api/v1/workspaces', json={'projectId': project['id'], 'expectedProjectVersion': 1}).json()
    assert index_count(migrated_database, opened['activeDatasetId']) == 2
    assert viewport(repository_api, opened).json()['matched'] == 2
    original_record = viewport(repository_api, opened).json()['records'][0]
    mutate(repository_api, opened, point(50, 50), original_record['summary']['id'])
    assert viewport(repository_api, opened, (1.5, 1.5, 2.5, 2.5)).json()['matched'] == 1
    assert viewport(repository_api, workspace, (1.5, 1.5, 2.5, 2.5)).json()['matched'] == 2
    assert index_count(migrated_database, project['savedDatasetId']) == 2


@pytest.mark.parametrize('bounds,tolerance', [([0, 0, 1], 0), ([1, 0, 0, 1], 0), ([-181, 0, 1, 1], 0), ([0, 0, 1, 1], -1), ([0, 0, 1, 1], 'nan')])
def test_invalid_viewport_is_explanatory_422(repository_api, bounds, tolerance):
    response = viewport(repository_api, new_workspace(repository_api), bounds, tolerance)
    assert response.status_code == 422 and response.json()['detail']


def test_missing_resources_and_invalid_mutations_are_safe(repository_api):
    workspace = new_workspace(repository_api)
    base = f"/api/v1/workspaces/{workspace['id']}"
    assert repository_api.get(f'/api/v1/workspaces/{uuid4()}/features').status_code == 404
    assert repository_api.get(base + f"/features/{workspace['generationId']}:999").status_code == 404
    for feature_value in ({'type': 'Feature', 'properties': {}, 'geometry': False}, None):
        response = repository_api.post(base + '/mutations', json={'feature': feature_value, **state(workspace)})
        assert response.status_code == 422
    assert current(repository_api, workspace) == workspace
    assert repository_api.post(base + '/mutations', json={'feature': point()}).status_code == 422


def test_repository_paths_are_in_swagger(repository_api):
    assert repository_api.get('/docs').status_code == 200
    paths = repository_api.get('/openapi.json').json()['paths']
    assert 'get' in paths['/api/v1/workspaces/{workspace_id}/viewport']
    assert 'get' in paths['/api/v1/workspaces/{workspace_id}/features']
    assert {'get', 'delete'} <= set(paths['/api/v1/workspaces/{workspace_id}/features/{feature_id}'])
    assert 'post' in paths['/api/v1/workspaces/{workspace_id}/mutations']
    assert {'get', 'post'} <= set(paths['/api/v1/workspaces/{workspace_id}/categories'])


def test_mutation_payload_limit_and_read_context_headers(repository_api, application):
    workspace = new_workspace(repository_api)
    response = viewport(repository_api, workspace)
    assert response.headers['x-dataset-id'] == workspace['activeDatasetId']
    assert response.headers['x-generation-id'] == workspace['generationId']
    assert response.headers['x-dataset-revision'] == '0'
    assert 'etag' in response.headers
    application.state.settings.repository_max_feature_bytes = 128
    oversized = point()
    oversized['properties']['large'] = 'x' * 256
    response = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", json={'feature': oversized, **state(workspace)})
    assert response.status_code == 413
    assert current(repository_api, workspace) == workspace


@pytest.mark.parametrize('origin', ['http://localhost:5173', 'http://127.0.0.1:5173'])
def test_frontend_cors_exposes_workspace_state_headers(repository_api, origin):
    workspace = new_workspace(repository_api)
    response = repository_api.get(f"/api/v1/workspaces/{workspace['id']}/features", headers={'Origin': origin})
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == origin
    exposed = {name.strip().lower() for name in response.headers['access-control-expose-headers'].split(',')}
    assert {'x-dataset-id', 'x-generation-id', 'x-dataset-revision', 'etag'} <= exposed
    assert response.headers['x-dataset-id'] == workspace['activeDatasetId']
    assert response.headers['x-generation-id'] == workspace['generationId']
    assert response.headers['x-dataset-revision'] == '0'


def test_reopening_same_generation_still_rejects_old_physical_dataset_context(repository_api, migrated_database):
    workspace = new_workspace(repository_api)
    added = mutate(repository_api, workspace, point())
    workspace = current(repository_api, workspace)
    saved = repository_api.post('/api/v1/projects', json={'workspaceId': workspace['id'], 'name': 'Same generation', **state(workspace)})
    assert saved.status_code == 201
    project = saved.json()
    opened = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/open-project", json={
        'projectId': project['id'], 'expectedProjectVersion': project['version'], **state(workspace)})
    assert opened.status_code == 200, opened.text
    reopened = opened.json()
    assert reopened['activeDatasetId'] != workspace['activeDatasetId']
    assert reopened['generationId'] == workspace['generationId']
    assert reopened['dataset']['revision'] == workspace['dataset']['revision']
    base = f"/api/v1/workspaces/{workspace['id']}"
    stale_requests = [
        repository_api.post(base + '/mutations', json={'id': added['id'], 'feature': point(10, 20), **state(workspace)}),
        repository_api.delete(base + f"/features/{added['id']}", params=state(workspace)),
        repository_api.post(base + '/categories', json={'name': 'Must not exist', **state(workspace)}),
        repository_api.post(base + '/empty', json=state(workspace)),
    ]
    assert [response.status_code for response in stale_requests] == [409, 409, 409, 409]
    assert current(repository_api, reopened) == reopened
    assert repository_api.get(base + '/categories').json() == []
    assert index_count(migrated_database, reopened['activeDatasetId']) == 1
    assert repository_api.get(f"/api/v1/projects/{project['id']}").json() == project


@pytest.mark.parametrize('setting,value', [
    ('repository_max_depth', 4), ('repository_max_nodes', 10), ('repository_max_feature_vertices', 1),
])
def test_each_feature_budget_returns_413_and_rolls_back(repository_api, application, migrated_database, setting, value):
    workspace = new_workspace(repository_api)
    setattr(application.state.settings, setting, value)
    feature = point()
    feature['geometry'] = {'type': 'LineString', 'coordinates': [[1, 2, 3], [3, 4, 5]]}
    response = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", json={'feature': feature, **state(workspace)})
    assert response.status_code == 413, response.text
    assert current(repository_api, workspace) == workspace
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0


@pytest.mark.parametrize('raw', [b'', b'{', b'[]', b'null', b'\xff', b'{"feature":NaN}', b'{"feature":Infinity}', b'{"feature":1e9999}'])
def test_invalid_json_is_422_without_changing_workspace(repository_api, migrated_database, raw):
    workspace = new_workspace(repository_api)
    response = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", content=raw, headers={'Content-Type': 'application/json'})
    assert response.status_code == 422, response.text
    assert response.json()['detail']
    assert current(repository_api, workspace) == workspace
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0


def test_viewport_budget_counts_utf8_bytes_before_decoding_selected_records(repository_api, migrated_database, application, monkeypatch):
    from app.services import spatial
    workspace = new_workspace(repository_api)
    original = point()
    original['properties']['unicode'] = 'ğ' * 400
    for _ in range(2):
        mutate(repository_api, workspace, original)
        workspace = current(repository_api, workspace)
    # The ORM's default JSON encoder escapes Unicode; use a legal UTF-8 JSON
    # representation to distinguish byte length from character length.
    encoded = json.dumps(original, ensure_ascii=False)
    with migrated_database.engine.begin() as connection:
        connection.execute(text('UPDATE features SET feature_json=:json WHERE dataset_id=:id'),
                           {'json': encoded, 'id': workspace['activeDatasetId']})
    assert len(encoded.encode('utf-8')) > len(encoded)
    application.state.settings.repository_max_viewport_bytes = len(encoded)
    def forbid_decode(_raw):
        pytest.fail('An over-budget viewport decoded original Feature JSON.')
    with monkeypatch.context() as patch:
        patch.setattr(spatial, 'json', SimpleNamespace(loads=forbid_decode))
        response = viewport(repository_api, workspace, limit=1)
    assert response.status_code == 413, response.text
    application.state.settings.repository_max_viewport_bytes = len(encoded.encode('utf-8'))
    one = viewport(repository_api, workspace, limit=1)
    assert one.status_code == 200 and one.json()['matched'] == 2 and one.json()['limited'] is True
    assert one.json()['records'][0]['feature'] == original
    assert viewport(repository_api, workspace, limit=2).status_code == 413
    assert current(repository_api, workspace) == workspace
    assert index_count(migrated_database, workspace['activeDatasetId']) == 2


def test_failed_write_rolls_back_rtree_feature_and_revision(repository_api, migrated_database):
    workspace = new_workspace(repository_api)
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER reject_repository_write BEFORE UPDATE OF count ON datasets
            WHEN NEW.count > OLD.count BEGIN SELECT RAISE(ABORT,'rollback probe'); END""")
    response = repository_api.post(f"/api/v1/workspaces/{workspace['id']}/mutations", json={'feature': point(), **state(workspace)})
    assert response.status_code in (500, 503)
    assert current(repository_api, workspace) == workspace
    assert repository_api.get(f"/api/v1/workspaces/{workspace['id']}/features").json()['total'] == 0
    assert index_count(migrated_database, workspace['activeDatasetId']) == 0


def test_rtree_migration_backfills_preexisting_live_bounds(settings, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from app.core.config import BACKEND_DIR
    from app.db.session import Database
    monkeypatch.setenv('GEOJSON_DATABASE_PATH', str(settings.database_path))
    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.upgrade(config, '0002_import_jobs')
    database = Database(settings)
    try:
        with database.sessions.begin() as session:
            service = DatasetService(session)
            dataset = service.create_dataset()
            dataset_id = dataset.id
            service.add_feature(dataset.id, point())
            service.add_feature(dataset.id, {'type': 'Feature', 'properties': None, 'geometry': None})
            deleted = service.add_feature(dataset.id, point(10, 20))
            service.delete_feature(dataset.id, deleted.id)
        command.upgrade(config, 'head')
        assert index_count(database, dataset_id) == 1
        with database.engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT rtreecheck('feature_rtree')").scalar_one() == 'ok'
    finally:
        database.dispose()
