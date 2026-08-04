from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app import main


client = TestClient(main.app)


def test_liveness() -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {"status": "ok"},
        "error": None,
    }


def test_readiness() -> None:
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {"status": "ready"},
        "error": None,
    }


def test_readiness_when_database_is_unavailable(monkeypatch) -> None:
    def unavailable() -> None:
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(main, "check_database", unavailable)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["success"] is False
    assert response.json()["data"] is None
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
