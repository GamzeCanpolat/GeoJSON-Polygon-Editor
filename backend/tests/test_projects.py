from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select, text

from app.db.models import Category, Dataset, Feature, Project, Subcategory, Workspace
from app.services.datasets import DatasetService


@pytest.fixture
def api(migrated_database, application):
    with TestClient(application) as client:
        yield client


def state(workspace):
    return {"expectedDatasetId": workspace["activeDatasetId"],
            "expectedGenerationId": workspace["generationId"], "expectedRevision": workspace["dataset"]["revision"]}


def new_workspace(api, **payload):
    response = api.post("/api/v1/workspaces", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def create_project(api, workspace, name="Proje"):
    response = api.post("/api/v1/projects", json={"workspaceId": workspace["id"], "name": name, **state(workspace)})
    assert response.status_code == 201, response.text
    return response.json()


def seed(api, database, workspace, features=()):
    ids = []
    with database.sessions.begin() as session:
        service = DatasetService(session)
        for feature in features:
            ids.append(service.add_feature(workspace["activeDatasetId"], feature).id)
    workspace = api.get(f"/api/v1/workspaces/{workspace['id']}").json()
    return workspace, ids


def snapshot_records(database, project):
    with database.sessions() as session:
        service = DatasetService(session)
        return [service.get_feature(project["savedDatasetId"], item.id).model_dump(by_alias=True)
                for item in service.list_features(project["savedDatasetId"]).items]


def counts(database):
    with database.sessions() as session:
        return [session.scalar(select(func.count(model.id))) for model in (Dataset, Feature, Category, Subcategory, Project)]


def point(name="Nokta"):
    return {"type": "Feature", "id": "external-42", "properties": {"name": name, "nested": {"keep": [None, True, 1, "1"]}},
            "geometry": {"type": "Point", "coordinates": [37, 39, 123]}, "foreign": {"keep": True}}


def polygon():
    return {"type": "Feature", "id": 42, "properties": {"ana_kategori": "Arazi", "alt_kategori": "Park", "kategori": "eski", "x": [1, False]},
            "geometry": {"type": "Polygon", "coordinates": [[[37,39,10],[38,39,11],[38,40,12],[37,39,10]]]}}


def test_empty_workspace_and_empty_saved_project(api, migrated_database):
    # A body is optional when creating a blank workspace.
    response = api.post("/api/v1/workspaces")
    assert response.status_code == 201
    workspace = response.json()
    assert workspace["projectId"] is None and workspace["dataset"]["revision"] == 0
    assert workspace["dataset"]["count"] == 0
    project = create_project(api, workspace, " Boş proje ")
    assert project["name"] == "Boş proje" and project["version"] == 1
    assert project["savedDatasetId"] != workspace["activeDatasetId"]
    assert project["generationId"] == workspace["generationId"]
    assert project["dataset"] == workspace["dataset"]
    assert project["createdAt"].endswith("Z") and project["updatedAt"].endswith("Z")
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json()["projectId"] == project["id"]
    with migrated_database.sessions() as session:
        assert session.get(Dataset, project["savedDatasetId"]).status == "snapshot"
        assert session.get(Dataset, workspace["activeDatasetId"]).status == "draft"


@pytest.mark.parametrize("geometry", [
    polygon()["geometry"], point()["geometry"],
    {"type": "LineString", "coordinates": [[37,39,1],[38,40,2]]},
    {"type": "MultiPoint", "coordinates": [[37,39,1],[38,40,2]]},
    {"type": "MultiLineString", "coordinates": [[[37,39],[38,40]]]},
    {"type": "MultiPolygon", "coordinates": [polygon()["geometry"]["coordinates"]]},
    {"type": "GeometryCollection", "geometries": [point()["geometry"], polygon()["geometry"]]},
    None,
])
def test_save_and_open_preserve_all_geometries_and_feature_fields(api, migrated_database, geometry):
    original = point()
    original["geometry"] = deepcopy(geometry)
    workspace, ids = seed(api, migrated_database, new_workspace(api), [original])
    project = create_project(api, workspace)
    reopened = new_workspace(api, projectId=project["id"], expectedProjectVersion=1)
    assert reopened["activeDatasetId"] not in {workspace["activeDatasetId"], project["savedDatasetId"]}
    assert reopened["generationId"] == workspace["generationId"]
    assert reopened["dataset"] == project["dataset"] == workspace["dataset"]
    with migrated_database.sessions() as session:
        record = DatasetService(session).get_feature(reopened["activeDatasetId"], ids[0])
        assert record.feature == original
        assert record.summary.id == ids[0]
    assert snapshot_records(migrated_database, project)[0]["feature"] == original


def test_multiple_features_catalog_tombstones_and_next_ordinal_survive_reopen(api, migrated_database):
    originals = [polygon(), point(), {"type":"Feature","properties":None,"geometry":None}]
    workspace, ids = seed(api, migrated_database, new_workspace(api), originals)
    with migrated_database.sessions.begin() as session:
        service = DatasetService(session)
        service.add_category(workspace["activeDatasetId"], "Kullanılmayan")
        service.add_category(workspace["activeDatasetId"], "Boş alt", parent="Kullanılmayan")
        service.delete_feature(workspace["activeDatasetId"], ids[1])
        catalog = service.category_metadata(workspace["activeDatasetId"])
    workspace = api.get(f"/api/v1/workspaces/{workspace['id']}").json()
    project = create_project(api, workspace)
    opened = new_workspace(api, projectId=project["id"], expectedProjectVersion=1)
    with migrated_database.sessions.begin() as session:
        service = DatasetService(session)
        assert service.category_metadata(opened["activeDatasetId"]) == catalog
        assert [item.id for item in service.list_features(opened["activeDatasetId"]).items] == [ids[0],ids[2]]
        assert service.get_feature(opened["activeDatasetId"], ids[0]).feature == originals[0]
        assert service.restore_feature(opened["activeDatasetId"], ids[1], originals[1]).id == ids[1]
        assert service.add_feature(opened["activeDatasetId"], point()).id.endswith(":3")
    assert project["dataset"]["revision"] == workspace["dataset"]["revision"]
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project


def test_workspace_changes_and_reopened_changes_cannot_modify_saved_snapshot(api, migrated_database):
    workspace, ids = seed(api, migrated_database, new_workspace(api), [polygon()])
    project = create_project(api, workspace)
    before = snapshot_records(migrated_database, project)
    with migrated_database.sessions.begin() as session:
        service = DatasetService(session)
        modified = deepcopy(polygon())
        modified["geometry"]["coordinates"][0][1][0] = 39
        service.update_feature(workspace["activeDatasetId"], ids[0], modified)
        service.add_feature(workspace["activeDatasetId"], point())
    reopened = new_workspace(api, projectId=project["id"], expectedProjectVersion=1)
    with migrated_database.sessions.begin() as session:
        service = DatasetService(session)
        service.delete_feature(reopened["activeDatasetId"], ids[0])
    assert snapshot_records(migrated_database, project) == before
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json()["dataset"]["count"] == 2
    assert api.get(f"/api/v1/workspaces/{reopened['id']}").json()["dataset"]["count"] == 0


def test_project_search_pagination_and_deterministic_order(api):
    for name in ["IĞDIR", "İstanbul", "Park % özel", "Park 2"]:
        create_project(api, new_workspace(api), name)
    result = api.get("/api/v1/projects", params={"search":"park","limit":1,"offset":1}).json()
    assert result["total"] == 2 and len(result["items"]) == 1
    assert api.get("/api/v1/projects", params={"search":"ığdır"}).json()["items"][0]["name"] == "IĞDIR"
    assert api.get("/api/v1/projects", params={"search":"istanbul"}).json()["total"] == 1
    assert api.get("/api/v1/projects", params={"search":"%"}).json()["total"] == 1
    assert api.get("/api/v1/projects", params={"offset":99}).json() == {"items":[],"total":4}
    items = api.get("/api/v1/projects").json()["items"]
    assert len(items) == 4
    assert [row["id"] for row in items] == [row["id"] for row in api.get("/api/v1/projects").json()["items"]]
    assert {"id","name","savedDatasetId","version","createdAt","updatedAt"} == set(items[0])


def test_resave_version_is_separate_from_dataset_revision_and_rename(api, migrated_database):
    workspace, _ = seed(api, migrated_database, new_workspace(api), [point()])
    project = create_project(api, workspace)
    workspace, _ = seed(api, migrated_database, workspace, [polygon(), point("Diğer")])
    request = {"workspaceId":workspace["id"],"expectedVersion":1,**state(workspace)}
    response = api.put(f"/api/v1/projects/{project['id']}/content",json=request)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["version"] == 2 and saved["dataset"]["revision"] == 3
    assert saved["savedDatasetId"] != project["savedDatasetId"]
    assert saved["createdAt"] == project["createdAt"]
    assert saved["updatedAt"] >= project["updatedAt"]
    assert api.put(f"/api/v1/projects/{project['id']}/content",json=request).status_code == 409
    renamed = api.patch(f"/api/v1/projects/{project['id']}",json={"name":"Yeni ad","expectedVersion":2})
    assert renamed.status_code == 200
    assert renamed.json()["version"] == 3 and renamed.json()["name"] == "Yeni ad"
    assert renamed.json()["savedDatasetId"] == saved["savedDatasetId"]
    assert renamed.json()["dataset"] == saved["dataset"]
    assert api.patch(f"/api/v1/projects/{project['id']}",json={"name":"Eski","expectedVersion":2}).status_code == 409


@pytest.mark.parametrize("field", ["expectedDatasetId","expectedGenerationId","expectedRevision"])
def test_stale_workspace_tokens_reject_save_without_mutating_project(api, migrated_database, field):
    workspace = new_workspace(api)
    project = create_project(api, workspace)
    token = state(workspace)
    token[field] = 1 if field == "expectedRevision" else str(uuid4())
    before = counts(migrated_database)
    response = api.put(f"/api/v1/projects/{project['id']}/content",json={"workspaceId":workspace["id"],"expectedVersion":1,**token})
    assert response.status_code == 409
    assert counts(migrated_database) == before
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project


def test_open_existing_workspace_preserves_source_and_other_workspace(api, migrated_database):
    source, ids = seed(api, migrated_database, new_workspace(api), [polygon()])
    project = create_project(api, source)
    target, _ = seed(api, migrated_database, new_workspace(api), [point()])
    payload = {"projectId":project["id"],"expectedProjectVersion":1,**state(target)}
    response = api.post(f"/api/v1/workspaces/{target['id']}/open-project",json=payload)
    assert response.status_code == 200, response.text
    opened = response.json()
    assert opened["id"] == target["id"] and opened["projectId"] == project["id"]
    assert opened["activeDatasetId"] != target["activeDatasetId"]
    assert opened["dataset"] == source["dataset"]
    with migrated_database.sessions() as session:
        assert DatasetService(session).get_feature(opened["activeDatasetId"],ids[0]).feature == polygon()
    # Replaying the old target token must not overwrite the newly opened draft.
    assert api.post(f"/api/v1/workspaces/{target['id']}/open-project",json=payload).status_code == 409
    assert api.get(f"/api/v1/workspaces/{source['id']}").json()["activeDatasetId"] == source["activeDatasetId"]


def test_workspace_and_project_mismatch_cannot_replace_unrelated_data(api):
    a, b = new_workspace(api), new_workspace(api)
    pa, pb = create_project(api,a,"A"), create_project(api,b,"B")
    response = api.put(f"/api/v1/projects/{pa['id']}/content",json={"workspaceId":b["id"],"expectedVersion":1,**state(b)})
    assert response.status_code == 409
    response = api.post(f"/api/v1/workspaces/{b['id']}/open-project",json={"projectId":pa["id"],"expectedProjectVersion":1,**state(a)})
    assert response.status_code == 409
    assert api.get(f"/api/v1/projects/{pa['id']}").json() == pa
    assert api.get(f"/api/v1/projects/{pb['id']}").json() == pb


def test_delete_project_keeps_workspace_drafts_and_detaches_links(api, migrated_database):
    workspace, _ = seed(api,migrated_database,new_workspace(api),[point()])
    project = create_project(api,workspace)
    opened = new_workspace(api,projectId=project["id"],expectedProjectVersion=1)
    assert api.delete(f"/api/v1/projects/{project['id']}",params={"expectedVersion":2}).status_code == 409
    response = api.delete(f"/api/v1/projects/{project['id']}",params={"expectedVersion":1})
    assert response.status_code == 204 and response.content == b""
    assert api.get(f"/api/v1/projects/{project['id']}").status_code == 404
    for previous in (workspace,opened):
        current = api.get(f"/api/v1/workspaces/{previous['id']}").json()
        assert current["projectId"] is None
        assert current["activeDatasetId"] == previous["activeDatasetId"]
        assert current["dataset"]["count"] == 1
    with migrated_database.sessions() as session:
        assert session.get(Dataset,project["savedDatasetId"]) is None


def test_shared_dataset_is_preserved_on_project_delete_and_resave(api, migrated_database):
    workspace = new_workspace(api)
    project = create_project(api,workspace)
    with migrated_database.sessions.begin() as session:
        other = Project(name="Shared",saved_dataset_id=project["savedDatasetId"])
        session.add(other)
        session.flush()
        other_id = other.id
    saved = api.put(f"/api/v1/projects/{project['id']}/content",json={"workspaceId":workspace["id"],"expectedVersion":1,**state(workspace)})
    assert saved.status_code == 200
    assert api.get(f"/api/v1/projects/{other_id}").json()["savedDatasetId"] == project["savedDatasetId"]
    assert api.delete(f"/api/v1/projects/{other_id}",params={"expectedVersion":1}).status_code == 204
    assert api.get(f"/api/v1/projects/{project['id']}").json() == saved.json()


@pytest.mark.parametrize("table", ["features","categories","subcategories"])
def test_failed_save_rolls_back_partial_snapshot_and_old_project(api,migrated_database,table):
    workspace, _ = seed(api,migrated_database,new_workspace(api),[polygon()])
    project = create_project(api,workspace)
    workspace = api.get(f"/api/v1/workspaces/{workspace['id']}").json()
    before = counts(migrated_database)
    parent = "(SELECT dataset_id FROM categories WHERE id=NEW.category_id)" if table == "subcategories" else "NEW.dataset_id"
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql(f"""CREATE TRIGGER fail_copy BEFORE INSERT ON {table}
            WHEN (SELECT status FROM datasets WHERE id={parent})='snapshot'
            BEGIN SELECT RAISE(ABORT,'private fault injection'); END""")
    response = api.put(f"/api/v1/projects/{project['id']}/content",json={"workspaceId":workspace["id"],"expectedVersion":1,**state(workspace)})
    assert response.status_code == 503 and "private" not in response.text
    assert counts(migrated_database) == before
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json() == workspace


def test_failed_open_preserves_workspace_after_copy_completed(api,migrated_database):
    source, _ = seed(api,migrated_database,new_workspace(api),[polygon()])
    project = create_project(api,source)
    target, _ = seed(api,migrated_database,new_workspace(api),[point()])
    before = counts(migrated_database)
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER fail_open BEFORE UPDATE OF active_dataset_id ON workspaces
            WHEN NEW.active_dataset_id != OLD.active_dataset_id
            BEGIN SELECT RAISE(ABORT,'private open failure'); END""")
    response = api.post(f"/api/v1/workspaces/{target['id']}/open-project",json={"projectId":project["id"],"expectedProjectVersion":1,**state(target)})
    assert response.status_code == 503
    assert api.get(f"/api/v1/workspaces/{target['id']}").json() == target
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert counts(migrated_database) == before


def test_failed_delete_rolls_back_project_and_workspace_link(api,migrated_database):
    workspace = new_workspace(api)
    project = create_project(api,workspace)
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER fail_cleanup BEFORE DELETE ON datasets
            WHEN OLD.status='snapshot' BEGIN SELECT RAISE(ABORT,'delete failure'); END""")
    assert api.delete(f"/api/v1/projects/{project['id']}",params={"expectedVersion":1}).status_code == 503
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json()["projectId"] == project["id"]


def test_validation_missing_ids_and_stale_project_open(api):
    unknown = str(uuid4())
    assert api.get(f"/api/v1/projects/{unknown}").status_code == 404
    assert api.get(f"/api/v1/workspaces/{unknown}").status_code == 404
    assert api.get("/api/v1/projects/not-uuid").status_code == 422
    assert api.get("/api/v1/projects",params={"limit":101}).status_code == 422
    assert api.post("/api/v1/workspaces",json={"projectId":unknown}).status_code == 422
    assert api.post("/api/v1/workspaces",json={"projectId":unknown,"expectedProjectVersion":1}).status_code == 404
    workspace = new_workspace(api)
    for invalid in ["", "  ", "x"*201]:
        assert api.post("/api/v1/projects",json={"workspaceId":workspace["id"],"name":invalid,**state(workspace)}).status_code == 422
    project = create_project(api,workspace)
    assert api.patch(f"/api/v1/projects/{project['id']}",json={"name":"ok","expectedVersion":True}).status_code == 422
    assert api.delete(f"/api/v1/projects/{project['id']}").status_code == 422
    assert api.post("/api/v1/workspaces",json={"projectId":project["id"],"expectedProjectVersion":2}).status_code == 409


def test_dataset_storage_token_rejects_replay_even_with_same_generation_and_revision(api):
    workspace = new_workspace(api)
    project = create_project(api, workspace)
    payload = {"projectId":project["id"],"expectedProjectVersion":1,**state(workspace)}
    opened = api.post(f"/api/v1/workspaces/{workspace['id']}/open-project",json=payload)
    assert opened.status_code == 200
    assert opened.json()["generationId"] == workspace["generationId"]
    assert opened.json()["dataset"]["revision"] == workspace["dataset"]["revision"]
    assert opened.json()["activeDatasetId"] != workspace["activeDatasetId"]
    assert api.post(f"/api/v1/workspaces/{workspace['id']}/open-project",json=payload).status_code == 409


def test_project_delete_preserves_snapshot_referenced_by_another_workspace(api,migrated_database):
    workspace, ids = seed(api,migrated_database,new_workspace(api),[point()])
    project = create_project(api,workspace)
    # Existing schema permits this reference even though new API workspaces
    # always receive their own mutable draft, never a shared snapshot.
    with migrated_database.sessions.begin() as session:
        other = Workspace(active_dataset_id=project["savedDatasetId"])
        session.add(other)
        session.flush()
        other_id = other.id
    assert api.delete(f"/api/v1/projects/{project['id']}",params={"expectedVersion":1}).status_code == 204
    assert api.get(f"/api/v1/workspaces/{other_id}").json()["activeDatasetId"] == project["savedDatasetId"]
    with migrated_database.sessions() as session:
        assert DatasetService(session).get_feature(project["savedDatasetId"],ids[0]).feature == point()


def test_failed_initial_save_rolls_back_completed_copy_and_workspace_link(api,migrated_database):
    workspace, _ = seed(api,migrated_database,new_workspace(api),[polygon()])
    before = counts(migrated_database)
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER fail_initial_save BEFORE INSERT ON projects
            BEGIN SELECT RAISE(ABORT,'project insert failure'); END""")
    response = api.post("/api/v1/projects",json={"workspaceId":workspace["id"],"name":"fail",**state(workspace)})
    assert response.status_code == 503
    assert counts(migrated_database) == before
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json() == workspace


def test_failed_old_snapshot_cleanup_rolls_back_project_pointer_and_version(api,migrated_database):
    workspace, _ = seed(api,migrated_database,new_workspace(api),[polygon()])
    project = create_project(api,workspace)
    workspace = api.get(f"/api/v1/workspaces/{workspace['id']}").json()
    before = counts(migrated_database)
    with migrated_database.engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER fail_old_cleanup BEFORE DELETE ON datasets
            WHEN OLD.status='snapshot' BEGIN SELECT RAISE(ABORT,'cleanup failure'); END""")
    response = api.put(f"/api/v1/projects/{project['id']}/content",json={"workspaceId":workspace["id"],"expectedVersion":1,**state(workspace)})
    assert response.status_code == 503
    assert counts(migrated_database) == before
    assert api.get(f"/api/v1/projects/{project['id']}").json() == project
    assert api.get(f"/api/v1/workspaces/{workspace['id']}").json() == workspace


def test_simultaneous_resaves_allow_only_one_expected_project_version(api,migrated_database):
    workspace, _ = seed(api,migrated_database,new_workspace(api),[polygon()])
    project = create_project(api,workspace)
    payload = {"workspaceId":workspace["id"],"expectedVersion":1,**state(workspace)}
    def save_once(_):
        return api.put(f"/api/v1/projects/{project['id']}/content",json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save_once,range(2))) == [200,409]
    assert api.get(f"/api/v1/projects/{project['id']}").json()["version"] == 2
    assert counts(migrated_database) == [2,2,2,2,1]
