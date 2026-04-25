"""Sanity test: pytest + FastAPI TestClient + DB override all wired up."""


def test_health_endpoint_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert "version" in body
    assert "timestamp" in body
