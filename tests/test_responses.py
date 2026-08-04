from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app import main


client = TestClient(main.app, raise_server_exceptions=False)


def test_success_response_uses_common_envelope() -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {"status": "ok"},
        "error": None,
    }


def test_framework_not_found_uses_common_error() -> None:
    response = client.get("/missing")

    assert response.status_code == 404
    assert response.json() == {
        "success": False,
        "data": None,
        "error": {
            "code": "NOT_FOUND",
            "message": "요청한 API를 찾을 수 없습니다.",
            "details": None,
        },
    }


def test_validation_error_excludes_input_value() -> None:
    response = client.post(
        "/auth/signup",
        json={
            "name": "테스트학생",
            "email": "student@example.com",
            "studentNumber": "private-invalid-value",
            "password": "example-password",
        },
    )

    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["details"] == [
        {
            "field": "body.studentNumber",
            "message": "String should match pattern '^[0-9]{5}$'",
            "type": "string_pattern_mismatch",
        }
    ]
    assert "private-invalid-value" not in response.text


def test_database_exception_returns_sanitized_service_unavailable(monkeypatch) -> None:
    def unavailable() -> None:
        raise SQLAlchemyError("private database host")

    monkeypatch.setattr(main, "check_database", unavailable)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert "private database host" not in response.text


def test_unhandled_exception_returns_sanitized_internal_error(monkeypatch) -> None:
    def broken() -> None:
        raise RuntimeError("private implementation detail")

    monkeypatch.setattr(main, "check_database", broken)

    response = client.get("/health/ready")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_SERVER_ERROR"
    assert "private implementation detail" not in response.text


def test_openapi_documents_common_success_and_error_models() -> None:
    operation = client.get("/openapi.json").json()["paths"]["/auth/signup"]["post"]
    success_schema = operation["responses"]["201"]["content"]["application/json"][
        "schema"
    ]
    validation_schema = operation["responses"]["422"]["content"][
        "application/json"
    ]["schema"]

    assert "ApiResponse" in success_schema["$ref"]
    assert validation_schema["$ref"].endswith("/ApiErrorResponse")
