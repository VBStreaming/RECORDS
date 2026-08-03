from datetime import datetime, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import main
from app import assignments as assignment_module
from app.db import get_db
from app.models import Assignment, User


def _user(email: str = "assignment-owner@example.com") -> User:
    return User(
        name="테스트학생",
        email=email,
        student_number="10311",
        password_hash="$argon2id$test-only-hash",
    )


def _assignment(user_id, subject: str = "MATH") -> Assignment:
    return Assignment(
        user_id=user_id,
        title="수학 프린트 3장",
        subject=subject,
        due_at=datetime(2026, 8, 8, 14, tzinfo=timezone.utc),
    )


@pytest.fixture
def client(db_session: Session):
    main.app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _signup_and_login(
    client: TestClient,
    *,
    email: str = "assignment-owner@example.com",
    student_number: str = "10311",
) -> tuple[dict[str, str], UUID]:
    signup = client.post(
        "/auth/signup",
        json={
            "name": "테스트학생",
            "email": email,
            "studentNumber": student_number,
            "password": "example-password",
        },
    )
    assert signup.status_code == 201
    login = client.post(
        "/auth/login",
        json={"email": email, "password": "example-password"},
    )
    assert login.status_code == 200
    return (
        {"Authorization": f"Bearer {login.json()['accessToken']}"},
        UUID(signup.json()["id"]),
    )


def _create_via_api(
    client: TestClient,
    headers: dict[str, str],
    **overrides: str,
):
    payload = {
        "title": "수학 프린트 3장",
        "subject": "MATH",
        "dueAt": "2026-08-08T23:00:00+09:00",
    }
    payload.update(overrides)
    return client.post("/assignments", json=payload, headers=headers)


def test_assignment_persists_for_its_owner(db_session: Session) -> None:
    user = _user()
    db_session.add(user)
    db_session.flush()
    assignment = _assignment(user.id)
    db_session.add(assignment)
    db_session.flush()

    stored = db_session.scalar(
        select(Assignment).where(
            Assignment.id == assignment.id,
            Assignment.user_id == user.id,
        )
    )

    assert stored is assignment
    assert stored.completed_at is None
    assert stored.created_at is not None
    assert stored.updated_at is not None


def test_assignment_rejects_unknown_subject(db_session: Session) -> None:
    user = _user()
    db_session.add(user)
    db_session.flush()

    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.add(_assignment(user.id, subject="ART"))
        db_session.flush()


def test_deleting_user_cascades_assignments(db_session: Session) -> None:
    user = _user()
    db_session.add(user)
    db_session.flush()
    db_session.add(_assignment(user.id))
    db_session.flush()

    db_session.execute(delete(User).where(User.id == user.id))
    db_session.flush()

    assert db_session.scalar(select(func.count()).select_from(Assignment)) == 0


def test_create_assignment_uses_token_owner_and_returns_dday(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user_id = _signup_and_login(client)
    monkeypatch.setattr(
        assignment_module,
        "_now_utc",
        lambda: datetime(2026, 8, 4, tzinfo=timezone.utc),
    )

    response = _create_via_api(
        client,
        headers,
        title=" 수학 프린트 3장 ",
    )

    assert response.status_code == 201
    assert response.json() == {
        "id": response.json()["id"],
        "title": "수학 프린트 3장",
        "subject": "MATH",
        "dueAt": "2026-08-08T14:00:00Z",
        "completed": False,
        "completedAt": None,
        "dayOffset": 4,
        "deadlineLabel": "D-4",
        "createdAt": response.json()["createdAt"],
        "updatedAt": response.json()["updatedAt"],
    }
    assert "userId" not in response.json()
    stored = db_session.get(Assignment, UUID(response.json()["id"]))
    assert stored is not None
    assert stored.user_id == user_id


@pytest.mark.parametrize(
    ("field", "value"),
    [("subject", "ART"), ("dueAt", "2026-08-08T23:00:00")],
)
def test_create_assignment_rejects_invalid_input(
    client: TestClient,
    field: str,
    value: str,
) -> None:
    headers, _ = _signup_and_login(client)

    response = _create_via_api(client, headers, **{field: value})

    assert response.status_code == 422


def test_assignment_endpoints_require_authentication(client: TestClient) -> None:
    response = _create_via_api(client, {})

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_TOKEN"


def test_list_assignments_uses_korean_date_boundaries_and_completion_filter(
    client: TestClient,
    db_session: Session,
) -> None:
    headers, _ = _signup_and_login(client)
    first = _create_via_api(
        client,
        headers,
        title="첫날 과제",
        dueAt="2026-08-01T00:00:00+09:00",
    )
    second = _create_via_api(
        client,
        headers,
        title="마지막날 과제",
        dueAt="2026-08-31T23:59:59+09:00",
    )
    outside = _create_via_api(
        client,
        headers,
        title="다음달 과제",
        dueAt="2026-09-01T00:00:00+09:00",
    )
    assert [first.status_code, second.status_code, outside.status_code] == [201, 201, 201]
    completed = db_session.get(Assignment, UUID(first.json()["id"]))
    assert completed is not None
    completed.completed_at = datetime(2026, 8, 2, tzinfo=timezone.utc)
    db_session.flush()

    all_response = client.get(
        "/assignments?from=2026-08-01&to=2026-08-31",
        headers=headers,
    )
    incomplete_response = client.get(
        "/assignments?from=2026-08-01&to=2026-08-31&completed=false",
        headers=headers,
    )

    assert all_response.status_code == 200
    assert [item["title"] for item in all_response.json()] == [
        "마지막날 과제",
        "첫날 과제",
    ]
    assert [item["title"] for item in incomplete_response.json()] == ["마지막날 과제"]


@pytest.mark.parametrize(
    "query",
    [
        "from=2026-09-01&to=2026-08-01",
        "from=2026-08-01&to=2026-10-02",
    ],
)
def test_list_assignments_rejects_invalid_date_range(
    client: TestClient,
    query: str,
) -> None:
    headers, _ = _signup_and_login(client)

    response = client.get(f"/assignments?{query}", headers=headers)

    assert response.status_code == 422


def test_assignment_detail_hides_other_users_assignment(client: TestClient) -> None:
    owner_headers, _ = _signup_and_login(client)
    created = _create_via_api(client, owner_headers)
    other_headers, _ = _signup_and_login(
        client,
        email="other-student@example.com",
        student_number="20311",
    )

    owner_response = client.get(
        f"/assignments/{created.json()['id']}",
        headers=owner_headers,
    )
    other_response = client.get(
        f"/assignments/{created.json()['id']}",
        headers=other_headers,
    )

    assert owner_response.status_code == 200
    assert other_response.status_code == 404
    assert other_response.json()["detail"]["code"] == "ASSIGNMENT_NOT_FOUND"
