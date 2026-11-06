from unittest.mock import Mock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import get_session


def test_startup_creates_database_and_health_checks_it(client, settings):
    assert settings.database_path.is_file()
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    assert client.get("/health").status_code == 404


def test_swagger_and_versioned_openapi(client):
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert set(schema["paths"]) == {
        "/api/v1/health", "/api/v1/workspaces", "/api/v1/workspaces/{workspace_id}",
        "/api/v1/workspaces/{workspace_id}/open-project", "/api/v1/projects",
        "/api/v1/projects/{project_id}", "/api/v1/projects/{project_id}/content",
        "/api/v1/geometry/validate", "/api/v1/workspaces/{workspace_id}/validate",
        "/api/v1/workspaces/{workspace_id}/imports", "/api/v1/workspaces/{workspace_id}/export",
        "/api/v1/jobs/{job_id}", "/api/v1/jobs/{job_id}/cancel", "/api/v1/jobs/{job_id}/activate",
        "/api/v1/workspaces/{workspace_id}/empty", "/api/v1/workspaces/{workspace_id}/viewport",
        "/api/v1/workspaces/{workspace_id}/features", "/api/v1/workspaces/{workspace_id}/features/{feature_id}",
        "/api/v1/workspaces/{workspace_id}/mutations", "/api/v1/workspaces/{workspace_id}/categories",
    }


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_frontend_cors(client, origin):
    response = client.options(
        "/api/v1/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert client.get("/api/v1/health", headers={"Origin": origin}).headers[
        "access-control-allow-origin"
    ] == origin


def test_unknown_origin_is_not_allowed(client):
    response = client.get("/api/v1/health", headers={"Origin": "https://unrelated.example"})
    assert "access-control-allow-origin" not in response.headers


def test_database_failure_returns_service_unavailable(application, client):
    session = Mock()
    session.execute.side_effect = SQLAlchemyError("private connection details")
    application.dependency_overrides[get_session] = lambda: session
    try:
        response = client.get("/api/v1/health")
        assert response.status_code == 503
        assert response.json() == {"detail": "Veritabanı bağlantısı kullanılamıyor."}
        assert "private connection details" not in response.text
    finally:
        application.dependency_overrides.clear()
