from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import main
from app.auth import ACCESS_TOKEN_SECONDS
from app.config import get_settings
from app.db import get_db
from app.models import User


@pytest.fixture
def client(db_session: Session):
    main.app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def signup_payload(**overrides: str) -> dict[str, str]:
    payload = {
        "name": " 테스트학생 ",
        "email": "Student@Example.com",
        "studentNumber": "10311",
        "password": "example-password",
    }
    payload.update(overrides)
    return payload


def test_signup_stores_argon2_and_returns_safe_user(client: TestClient, db_session: Session) -> None:
    response = client.post("/auth/signup", json=signup_payload())

    assert response.status_code == 201
    data = response.json()["data"]
    assert response.json() == {
        "success": True,
        "data": {
            "id": data["id"],
            "name": "테스트학생",
            "email": "student@example.com",
            "studentNumber": "10311",
        },
        "error": None,
    }
    assert "password" not in response.text
    assert "password_hash" not in response.text

    user = db_session.scalar(select(User).where(User.email == "student@example.com"))
    assert user is not None
    assert user.password_hash.startswith("$argon2")


def test_signup_rejects_case_insensitive_duplicate_email(client: TestClient) -> None:
    assert client.post("/auth/signup", json=signup_payload()).status_code == 201

    response = client.post(
        "/auth/signup",
        json=signup_payload(email="STUDENT@example.com", studentNumber="20311"),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"


def test_signup_allows_duplicate_student_number(client: TestClient) -> None:
    assert client.post("/auth/signup", json=signup_payload()).status_code == 201

    response = client.post(
        "/auth/signup",
        json=signup_payload(email="other@example.com"),
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("field", "value"),
    [("studentNumber", "1234"), ("password", "short")],
)
def test_signup_rejects_invalid_fields(
    client: TestClient, field: str, value: str
) -> None:
    response = client.post("/auth/signup", json=signup_payload(**{field: value}))

    assert response.status_code == 422


def test_login_returns_thirty_minute_access_token(client: TestClient) -> None:
    assert client.post("/auth/signup", json=signup_payload()).status_code == 201

    response = client.post(
        "/auth/login",
        json={"email": " STUDENT@example.com ", "password": "example-password"},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["tokenType"] == "bearer"
    assert body["expiresIn"] == ACCESS_TOKEN_SECONDS
    payload = jwt.decode(
        body["accessToken"],
        get_settings().jwt_secret_key,
        algorithms=["HS256"],
    )
    assert set(payload) == {"sub", "iat", "exp"}
    assert payload["exp"] - payload["iat"] == ACCESS_TOKEN_SECONDS


def test_login_hides_unknown_email_and_wrong_password(client: TestClient) -> None:
    assert client.post("/auth/signup", json=signup_payload()).status_code == 201

    responses = [
        client.post(
            "/auth/login",
            json={"email": "missing@example.com", "password": "example-password"},
        ),
        client.post(
            "/auth/login",
            json={"email": "student@example.com", "password": "wrong-password"},
        ),
    ]

    assert [response.status_code for response in responses] == [401, 401]
    assert responses[0].json() == responses[1].json()
    assert all(response.headers["www-authenticate"] == "Bearer" for response in responses)


def test_current_user_requires_valid_token(client: TestClient) -> None:
    signup_response = client.post("/auth/signup", json=signup_payload())
    user_id = signup_response.json()["data"]["id"]
    login_response = client.post(
        "/auth/login",
        json={"email": "student@example.com", "password": "example-password"},
    )

    response = client.get(
        "/users/me",
        headers={
            "Authorization": f"Bearer {login_response.json()['data']['accessToken']}"
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["id"] == user_id
    assert response.json()["data"]["email"] == "student@example.com"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer forged"}])
def test_current_user_rejects_missing_or_forged_token(
    client: TestClient, headers: dict[str, str]
) -> None:
    response = client.get("/users/me", headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_TOKEN"
    assert response.headers["www-authenticate"] == "Bearer"


def test_current_user_rejects_expired_token(client: TestClient) -> None:
    token = jwt.encode(
        {
            "sub": "00000000-0000-4000-8000-000000000001",
            "iat": datetime.now(timezone.utc) - timedelta(hours=1),
            "exp": datetime.now(timezone.utc) - timedelta(minutes=30),
        },
        get_settings().jwt_secret_key,
        algorithm="HS256",
    )

    response = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_TOKEN"
