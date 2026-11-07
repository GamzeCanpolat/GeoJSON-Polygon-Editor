from copy import deepcopy
import json
import multiprocessing
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, text

from app.domain.topology import validate_topology
from app.services.datasets import DatasetService
from app.services.projects import ProjectService

SHELL = [[0,0],[4,0],[4,4],[0,4],[0,0]]
BOW = [[0,0],[2,2],[2,0],[0,2],[0,0]]
HOLE = [[1,1],[1,2],[2,2],[2,1],[1,1]]
OUTSIDE = [[5,5],[5,6],[6,6],[6,5],[5,5]]


def feature(geometry, **extra):
    return {"type":"Feature", "properties":{"nested":{"keep":[True,None,"Şırnak"]}}, "geometry":geometry, **extra}


def polygon(ring=SHELL, holes=()):
    return {"type":"Polygon", "coordinates":[deepcopy(ring), *deepcopy(holes)]}


def direct(geometry, max_issues=20):
    return validate_topology({"geometry":geometry,"hasZ":False,"featureIndex":None,"featureId":None},max_issues)


@pytest.fixture
def validation_api(application, migrated_database):
    with TestClient(application) as client:
        yield client


@pytest.mark.parametrize("geometry,valid,code", [
    (polygon(),True,None),
    (polygon(BOW),False,"SELF_INTERSECTION"),
    (polygon(holes=[HOLE]),True,None),
    (polygon(holes=[OUTSIDE]),False,"HOLE_OUTSIDE_SHELL"),
    ({"type":"MultiPolygon","coordinates":[[SHELL],[SHELL]]},False,"MULTIPOLYGON_OVERLAP"),
    ({"type":"MultiPolygon","coordinates":[[BOW]]},False,"SELF_INTERSECTION"),
    ({"type":"Point","coordinates":[37,39]},True,None),
    ({"type":"LineString","coordinates":[[37,39],[38,40]]},True,None),
    ({"type":"GeometryCollection","geometries":[polygon(),{"type":"Point","coordinates":[1,1]}]},True,None),
    ({"type":"GeometryCollection","geometries":[polygon(BOW)]},False,"SELF_INTERSECTION"),
    ({"type":"GeometryCollection","geometries":[]},False,"EMPTY_GEOMETRY"),
    ({"type":"MultiPoint","coordinates":[]},False,"EMPTY_GEOMETRY"),
    ({"type":"MultiPolygon","coordinates":[]},False,"EMPTY_GEOMETRY"),
    ({"type":"LineString","coordinates":[[1,1],[1,1]]},False,"DEGENERATE_GEOMETRY"),
    (polygon([[1,1],[1,1],[1,1],[1,1]]),False,"DEGENERATE_GEOMETRY"),
    (polygon([[0,0],[4,0],[4,0],[4,4],[0,4],[0,0]]),True,None),
    (None,True,None),
])
def test_topology_diagnostics(geometry,valid,code):
    original = deepcopy(geometry)
    result = direct(geometry)
    assert result["valid"] is valid
    assert geometry == original
    if code:
        assert result["errors"][0]["code"] == code
    if geometry is None:
        assert result["warnings"][0]["code"] == "NULL_GEOMETRY"


def test_intersecting_and_nested_holes_are_invalid():
    overlap = [[1.5,1.5],[1.5,3],[3,3],[3,1.5],[1.5,1.5]]
    nested = [[1.2,1.2],[1.2,1.8],[1.8,1.8],[1.8,1.2],[1.2,1.2]]
    assert direct(polygon(holes=[HOLE,overlap]))["errors"][0]["code"] == "HOLES_INTERSECTION"
    assert direct(polygon(holes=[HOLE,nested]))["errors"][0]["code"] == "NESTED_HOLES"


def test_collection_component_paths_and_report_limit():
    result = direct({"type":"GeometryCollection","geometries":[polygon(BOW)]*5},max_issues=2)
    assert len(result["errors"]) == 2
    assert result["errors"][0]["path"] == "geometry.geometries[0]"
    assert result["warnings"][-1]["code"] == "ISSUE_LIMIT_REACHED"


def test_valid_and_invalid_polygon_api_reports(validation_api):
    response = validation_api.post("/api/v1/geometry/validate",json=feature(polygon()))
    assert response.status_code == 200, response.text
    valid = response.json()
    assert valid["valid"] and valid["errors"] == [] and valid["geometryType"] == "Polygon"
    response = validation_api.post("/api/v1/geometry/validate",json=feature(polygon(BOW),id="external-id"))
    assert response.status_code == 200, response.text
    report = response.json()
    assert not report["valid"] and report["featureCount"] == 1
    assert report["errors"][0]["code"] == "SELF_INTERSECTION"
    assert report["errors"][0]["message"] == "Polygon kendi kendini kesiyor."
    assert report["location"] == [1,1]
    assert report["featureId"] is None and report["results"][0]["featureId"] is None
    assert report["results"][0]["featureIndex"] is None
    assert {"valid","geometryType","errors","warnings","message","featureIndex","featureId","location"} <= set(report)


def test_collection_api_reports_index_and_allows_overlap_between_features(validation_api):
    original = {"type":"FeatureCollection","category_catalog":[{"name":"Boş", "subcategories":[]}],
                "features":[feature(polygon(),id=7),feature(polygon(),id=7),feature(polygon(BOW))],"custom":{"keep":True}}
    before = deepcopy(original)
    response = validation_api.post("/api/v1/geometry/validate",json=original)
    assert response.status_code == 200
    report = response.json()
    assert report["featureCount"] == 3 and report["geometryType"] == "FeatureCollection"
    assert [result["valid"] for result in report["results"]] == [True,True,False]
    assert report["errors"][0]["featureIndex"] == 2 and report["errors"][0]["featureId"] is None
    assert original == before


def test_z_null_and_foreign_members_are_not_changed(application,validation_api):
    original = feature({"type":"GeometryCollection","geometries":[
        {"type":"Point","coordinates":[37,39,123],"foreign":"keep"},
        {"type":"LineString","coordinates":[[37,39,10,7],[38,40,20,8]]},
    ]},id="outside",bbox=[37,39,38,40],extra={"keep":True})
    before = deepcopy(original)
    from app.services.geometry_validation import GeometryValidationService
    report = GeometryValidationService(application.state.settings,application.state.validation_slots).validate_document(original)
    assert report.valid and original == before
    assert report.warnings[0].code == "EXTRA_DIMENSIONS_IGNORED"
    null = validation_api.post("/api/v1/geometry/validate",json=feature(None)).json()
    assert null["valid"] and null["geometryType"] is None and null["results"][0]["warnings"][0]["code"] == "NULL_GEOMETRY"


@pytest.mark.parametrize("value", [
    {}, [], {"type":"Point","coordinates":[1,2]},
    {"type":"Feature","properties":{}},
    feature({"type":"Point","coordinates":[37]}),
    feature({"type":"Point","coordinates":[181,39]}),
    feature({"type":"Point","coordinates":[37,91]}),
    feature({"type":"Point","coordinates":[True,39]}),
    feature(polygon([[0,0],[1,0],[1,1],[0,1]])),
    feature(polygon([[0,0],[1,1],[0,0]])),
    feature({"type":"MultiPolygon","coordinates":[[1,2]]}),
    feature({"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[]}]}),
    {"type":"FeatureCollection","features":{}},
    {"type":"FeatureCollection","features":[feature(None),42]},
    {"type":"FeatureCollection","features":[feature(None)],"category_catalog":None},
])
def test_invalid_structures_return_422_not_server_errors(validation_api,value):
    response = validation_api.post("/api/v1/geometry/validate",json=value)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_GEOJSON"


@pytest.mark.parametrize("token", ["NaN","Infinity","-Infinity","1e999"])
def test_non_finite_numbers_and_invalid_json_return_json_422(validation_api,token):
    document = '{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[37,'+token+']}}'
    response = validation_api.post("/api/v1/geometry/validate",content=document,headers={"Content-Type":"application/json"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_JSON"


def test_empty_and_invalid_json_and_empty_collection(validation_api):
    for content in (b'',b'{"type":',b'\xff'):
        assert validation_api.post("/api/v1/geometry/validate",content=content).status_code == 422
    response = validation_api.post("/api/v1/geometry/validate",json={"type":"FeatureCollection","features":[]})
    assert response.status_code == 200 and response.json()["valid"] and response.json()["featureCount"] == 0


def test_workspace_validation_preserves_all_rows_revisions_versions_and_snapshot(validation_api,migrated_database):
    with migrated_database.sessions.begin() as session:
        projects = ProjectService(session)
        workspace = projects.create_workspace()
        service = DatasetService(session)
        good = service.add_feature(workspace.active_dataset_id,feature(polygon(),id="source-good"))
        bad = service.add_feature(workspace.active_dataset_id,feature(polygon(BOW),id=42))
        deleted = service.add_feature(workspace.active_dataset_id,feature(None))
        service.delete_feature(workspace.active_dataset_id,deleted.id)
        service.add_category(workspace.active_dataset_id,"Kullanılmayan")
        workspace = projects.get_workspace(workspace.id)
        project = projects.create_project(workspace.id,"Kayıt",expected_dataset_id=workspace.active_dataset_id,
                    expected_generation_id=workspace.generation_id,expected_revision=workspace.dataset.revision)
        snapshot_id = project.saved_dataset_id
        workspace_id = workspace.id
    def rows():
        with migrated_database.engine.connect() as connection:
            return {table:[tuple(row) for row in connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id')]
                    for table in ('datasets','features','categories','subcategories','projects','workspaces')}
    before = rows()
    statements = []
    engine = validation_api.app.state.database.engine
    def capture(_connection,_cursor,statement,_parameters,_context,_executemany):
        statements.append(statement.lstrip().upper())
    event.listen(engine,"before_cursor_execute",capture)
    try:
        response = validation_api.post(f"/api/v1/workspaces/{workspace_id}/validate")
    finally:
        event.remove(engine,"before_cursor_execute",capture)
    assert response.status_code == 200, response.text
    report = response.json()
    assert not report["valid"] and report["featureCount"] == 2
    assert report["errors"][0]["featureId"] == bad.id
    assert report["results"][0]["featureId"] == good.id
    assert report["errors"][0]["featureIndex"] == 1
    assert report["revision"] == workspace.dataset.revision
    assert report["datasetId"] == workspace.active_dataset_id
    assert report["generationId"] == workspace.generation_id
    assert rows() == before
    assert not any(statement.startswith(("INSERT","UPDATE","DELETE","CREATE","DROP","ALTER")) for statement in statements)
    with migrated_database.sessions() as session:
        assert DatasetService(session).get_feature(snapshot_id,bad.id).feature == feature(polygon(BOW),id=42)


def test_workspace_not_found_or_invalid_uuid_and_empty_workspace(validation_api):
    assert validation_api.post(f"/api/v1/workspaces/{uuid4()}/validate").status_code == 404
    assert validation_api.post("/api/v1/workspaces/not-uuid/validate").status_code == 422
    workspace = validation_api.post("/api/v1/workspaces").json()
    response = validation_api.post(f"/api/v1/workspaces/{workspace['id']}/validate")
    assert response.status_code == 200 and response.json()["featureCount"] == 0


@pytest.mark.parametrize("setting,value,document", [
    ("validation_max_features",1,{"type":"FeatureCollection","features":[feature(None),feature(None)]}),
    ("validation_max_vertices",2,feature(polygon())),
    ("validation_max_feature_vertices",2,feature(polygon())),
    ("validation_max_bytes",128,feature(None,extra="x"*256)),
    ("validation_max_depth",4,feature(None,extra={"a":{"b":{"c":{"d":1}}}})),
    ("validation_max_nodes",10,feature(None,extra=list(range(20)))),
])
def test_configurable_limits_reject_before_unbounded_work(application,validation_api,setting,value,document):
    setattr(application.state.settings,setting,value)
    assert validation_api.post("/api/v1/geometry/validate",json=document).status_code == 413


def test_chunked_body_size_is_checked_without_content_length(application,validation_api):
    application.state.settings.validation_max_bytes = 128
    def chunks():
        yield b'{"type":"Feature","extra":"'
        yield b'x'*256
        yield b'"}'
    assert validation_api.post("/api/v1/geometry/validate",content=chunks()).status_code == 413


def test_workspace_size_counts_properties_not_only_source_bytes(application,validation_api,migrated_database):
    with migrated_database.sessions.begin() as session:
        workspace = ProjectService(session).create_workspace()
        DatasetService(session).add_feature(workspace.active_dataset_id,feature(None,properties={"large":"x"*512}))
    application.state.settings.validation_max_bytes = 128
    assert validation_api.post(f"/api/v1/workspaces/{workspace.id}/validate").status_code == 413


def test_capacity_and_timeout_are_bounded_without_leaving_child_processes(application,validation_api):
    slots = application.state.validation_slots
    held = application.state.settings.validation_max_concurrent
    for _ in range(held):
        slots.acquire()
    try:
        response = validation_api.post("/api/v1/geometry/validate",json=feature(polygon()))
        assert response.status_code == 429
    finally:
        for _ in range(held):
            slots.release()
    before = {child.pid for child in multiprocessing.active_children()}
    application.state.settings.validation_timeout_seconds = 0.001
    response = validation_api.post("/api/v1/geometry/validate",json=feature(polygon()))
    assert response.status_code == 408
    assert {child.pid for child in multiprocessing.active_children()} == before


def test_swagger_documents_validation_requests_and_responses(validation_api):
    assert validation_api.get('/docs').status_code == 200
    schema = validation_api.get('/openapi.json').json()
    direct_schema = schema['paths']['/api/v1/geometry/validate']['post']
    assert direct_schema['requestBody']['required'] is True
    assert 'application/geo+json' in direct_schema['requestBody']['content']
    assert direct_schema['responses']['200']['content']['application/json']['schema']['$ref'].endswith('/GeometryValidationReport')
    assert '422' in direct_schema['responses'] and '413' in direct_schema['responses']
    assert 'post' in schema['paths']['/api/v1/workspaces/{workspace_id}/validate']


def slow_validation_worker(_items,_max_issues,_output_path):
    import time
    time.sleep(10)


def test_hard_deadline_stops_an_already_started_worker(application,monkeypatch):
    from multiprocessing.process import BaseProcess
    from app.services import geometry_validation as module
    started = []
    original_start = BaseProcess.start
    def start(process):
        original_start(process)
        started.append(process.pid)
    monkeypatch.setattr(BaseProcess,"start",start)
    monkeypatch.setattr(module,"write_validation_results",slow_validation_worker)
    application.state.settings.validation_timeout_seconds = 0.1
    service = module.GeometryValidationService(application.state.settings,application.state.validation_slots)
    with pytest.raises(module.GeometryValidationError) as failure:
        service.validate_document(feature(polygon()))
    assert failure.value.status_code == 408 and started
    assert not set(started) & {child.pid for child in multiprocessing.active_children()}
    assert application.state.validation_slots.acquire(blocking=False)
    application.state.validation_slots.release()


def test_geos_construction_failure_is_a_normal_invalid_result(monkeypatch):
    from shapely.errors import GEOSException
    from app.domain import topology
    def fail(_geometry):
        raise GEOSException("construction probe")
    monkeypatch.setattr(topology,"shape",fail)
    result = direct(polygon())
    assert not result["valid"] and result["errors"][0]["code"] == "GEOMETRY_CONSTRUCTION_FAILED"


@pytest.mark.parametrize("setting,value",[("validation_max_features",1),("validation_max_vertices",1)])
def test_workspace_limits_apply_before_shapely(application,validation_api,migrated_database,setting,value):
    with migrated_database.sessions.begin() as session:
        workspace = ProjectService(session).create_workspace()
        service = DatasetService(session)
        service.add_feature(workspace.active_dataset_id,feature(polygon()))
        service.add_feature(workspace.active_dataset_id,feature(None))
    setattr(application.state.settings,setting,value)
    response = validation_api.post(f"/api/v1/workspaces/{workspace.id}/validate")
    assert response.status_code == 413
