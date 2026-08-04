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


def _data(response):
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    return body["data"]


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
        {"Authorization": f"Bearer {_data(login)['accessToken']}"},
        UUID(_data(signup)["id"]),
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
    data = _data(response)
    assert response.json() == {
        "success": True,
        "data": {
            "id": data["id"],
            "title": "수학 프린트 3장",
            "subject": "MATH",
            "dueAt": "2026-08-08T14:00:00Z",
            "completed": False,
            "completedAt": None,
            "dayOffset": 4,
            "deadlineLabel": "D-4",
            "createdAt": data["createdAt"],
            "updatedAt": data["updatedAt"],
        },
        "error": None,
    }
    assert "userId" not in data
    stored = db_session.get(Assignment, UUID(data["id"]))
    assert stored is not None
    assert stored.user_id == user_id


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("subject", "ART"),
        ("dueAt", "2026-08-08T23:00:00"),
        ("title", 123),
    ],
)
def test_create_assignment_rejects_invalid_input(
    client: TestClient,
    field: str,
    value: object,
) -> None:
    headers, _ = _signup_and_login(client)

    response = _create_via_api(client, headers, **{field: value})

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("due_at", "now", "expected"),
    [
        (
            datetime(2026, 12, 31, 15, tzinfo=timezone.utc),
            datetime(2026, 12, 31, 14, 59, tzinfo=timezone.utc),
            (1, "D-1"),
        ),
        (
            datetime(2026, 8, 4, 0, tzinfo=timezone.utc),
            datetime(2026, 8, 4, 14, tzinfo=timezone.utc),
            (0, "D-Day"),
        ),
        (
            datetime(2026, 8, 3, 14, tzinfo=timezone.utc),
            datetime(2026, 8, 4, 0, tzinfo=timezone.utc),
            (-1, "1일 지남"),
        ),
    ],
)
def test_deadline_uses_korean_calendar_dates(
    due_at: datetime,
    now: datetime,
    expected: tuple[int, str],
) -> None:
    assert assignment_module._deadline(due_at, now) == expected


def test_assignment_endpoints_require_authentication(client: TestClient) -> None:
    response = _create_via_api(client, {})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_TOKEN"


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
    completed = db_session.get(Assignment, UUID(_data(first)["id"]))
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
    assert [item["title"] for item in _data(all_response)] == [
        "마지막날 과제",
        "첫날 과제",
    ]
    assert [item["title"] for item in _data(incomplete_response)] == [
        "마지막날 과제"
    ]


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
        f"/assignments/{_data(created)['id']}",
        headers=owner_headers,
    )
    other_response = client.get(
        f"/assignments/{_data(created)['id']}",
        headers=other_headers,
    )

    assert owner_response.status_code == 200
    assert other_response.status_code == 404
    assert other_response.json()["error"]["code"] == "ASSIGNMENT_NOT_FOUND"


def test_update_assignment_changes_only_supplied_fields(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _ = _signup_and_login(client)
    created = _create_via_api(client, headers)
    update_time = datetime(2026, 8, 5, 3, tzinfo=timezone.utc)
    monkeypatch.setattr(assignment_module, "_now_utc", lambda: update_time)

    response = client.patch(
        f"/assignments/{_data(created)['id']}",
        json={
            "title": " 영어 에세이 ",
            "subject": "ENGLISH",
            "dueAt": "2026-08-10T23:00:00+09:00",
        },
        headers=headers,
    )

    assert response.status_code == 200
    data = _data(response)
    assert data["title"] == "영어 에세이"
    assert data["subject"] == "ENGLISH"
    assert data["dueAt"] == "2026-08-10T14:00:00Z"
    assert data["updatedAt"] == "2026-08-05T03:00:00Z"
    assert data["completed"] is False


@pytest.mark.parametrize("payload", [{}, {"title": None}])
def test_update_assignment_rejects_empty_or_null_fields(
    client: TestClient,
    payload: dict,
) -> None:
    headers, _ = _signup_and_login(client)
    created = _create_via_api(client, headers)

    response = client.patch(
        f"/assignments/{_data(created)['id']}",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 422


def test_completion_is_idempotent_and_can_be_reopened(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _ = _signup_and_login(client)
    created = _create_via_api(client, headers)
    endpoint = f"/assignments/{_data(created)['id']}/completion"
    current_time = datetime(2026, 8, 5, 3, tzinfo=timezone.utc)
    monkeypatch.setattr(assignment_module, "_now_utc", lambda: current_time)

    completed = client.put(endpoint, json={"completed": True}, headers=headers)
    assert completed.status_code == 200
    assert _data(completed)["completedAt"] == "2026-08-05T03:00:00Z"
    assert _data(completed)["updatedAt"] == "2026-08-05T03:00:00Z"

    current_time = datetime(2026, 8, 6, 3, tzinfo=timezone.utc)
    completed_again = client.put(endpoint, json={"completed": True}, headers=headers)
    assert completed_again.status_code == 200
    assert _data(completed_again)["completedAt"] == _data(completed)["completedAt"]
    assert _data(completed_again)["updatedAt"] == _data(completed)["updatedAt"]

    current_time = datetime(2026, 8, 7, 3, tzinfo=timezone.utc)
    reopened = client.put(endpoint, json={"completed": False}, headers=headers)
    assert reopened.status_code == 200
    assert _data(reopened)["completed"] is False
    assert _data(reopened)["completedAt"] is None
    assert _data(reopened)["updatedAt"] == "2026-08-07T03:00:00Z"

    current_time = datetime(2026, 8, 8, 3, tzinfo=timezone.utc)
    reopened_again = client.put(endpoint, json={"completed": False}, headers=headers)
    assert reopened_again.status_code == 200
    assert _data(reopened_again)["updatedAt"] == _data(reopened)["updatedAt"]


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("patch", "", {"title": "가로채기"}),
        ("put", "/completion", {"completed": True}),
    ],
)
def test_update_endpoints_hide_other_users_assignment(
    client: TestClient,
    method: str,
    suffix: str,
    payload: dict,
) -> None:
    owner_headers, _ = _signup_and_login(client)
    created = _create_via_api(client, owner_headers)
    other_headers, _ = _signup_and_login(
        client,
        email="other-student@example.com",
        student_number="20311",
    )

    response = client.request(
        method,
        f"/assignments/{_data(created)['id']}{suffix}",
        json=payload,
        headers=other_headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ASSIGNMENT_NOT_FOUND"


def test_delete_assignment_removes_only_owned_assignment(client: TestClient) -> None:
    owner_headers, _ = _signup_and_login(client)
    created = _create_via_api(client, owner_headers)
    other_headers, _ = _signup_and_login(
        client,
        email="other-student@example.com",
        student_number="20311",
    )
    endpoint = f"/assignments/{_data(created)['id']}"

    forbidden = client.delete(endpoint, headers=other_headers)
    owner_can_still_read = client.get(endpoint, headers=owner_headers)
    deleted = client.delete(endpoint, headers=owner_headers)
    deleted_again = client.delete(endpoint, headers=owner_headers)

    assert forbidden.status_code == 404
    assert forbidden.json()["error"]["code"] == "ASSIGNMENT_NOT_FOUND"
    assert owner_can_still_read.status_code == 200
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert deleted_again.status_code == 404


def test_dashboard_is_empty_without_active_assignments(client: TestClient) -> None:
    headers, _ = _signup_and_login(client)

    response = client.get("/dashboard", headers=headers)

    assert response.status_code == 200
    assert _data(response) == {"activeCount": 0, "nearestAssignment": None}


def test_dashboard_counts_current_user_and_prefers_recent_overdue(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _ = _signup_and_login(client)
    current_time = datetime(2026, 8, 4, 3, tzinfo=timezone.utc)
    monkeypatch.setattr(assignment_module, "_now_utc", lambda: current_time)
    _create_via_api(
        client,
        headers,
        title="오래 지난 과제",
        dueAt="2026-08-01T09:00:00+09:00",
    )
    recent_overdue = _create_via_api(
        client,
        headers,
        title="방금 지난 과제",
        dueAt="2026-08-04T11:00:00+09:00",
    )
    _create_via_api(
        client,
        headers,
        title="다가오는 과제",
        dueAt="2026-08-05T09:00:00+09:00",
    )
    completed = _create_via_api(
        client,
        headers,
        title="완료 과제",
        dueAt="2026-08-06T09:00:00+09:00",
    )
    client.put(
        f"/assignments/{_data(completed)['id']}/completion",
        json={"completed": True},
        headers=headers,
    )
    other_headers, _ = _signup_and_login(
        client,
        email="other-student@example.com",
        student_number="20311",
    )
    _create_via_api(
        client,
        other_headers,
        title="다른 사용자 과제",
        dueAt="2026-08-04T11:30:00+09:00",
    )

    response = client.get("/dashboard", headers=headers)

    assert recent_overdue.status_code == 201
    assert response.status_code == 200
    data = _data(response)
    assert data["activeCount"] == 3
    assert data["nearestAssignment"]["title"] == "방금 지난 과제"
    assert data["nearestAssignment"]["deadlineLabel"] == "D-Day"


def test_dashboard_uses_earliest_upcoming_when_nothing_is_overdue(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _ = _signup_and_login(client)
    current_time = datetime(2026, 8, 4, 3, tzinfo=timezone.utc)
    monkeypatch.setattr(assignment_module, "_now_utc", lambda: current_time)
    _create_via_api(
        client,
        headers,
        title="나중 과제",
        dueAt="2026-08-06T09:00:00+09:00",
    )
    _create_via_api(
        client,
        headers,
        title="먼저 과제",
        dueAt="2026-08-05T09:00:00+09:00",
    )

    response = client.get("/dashboard", headers=headers)

    assert response.status_code == 200
    data = _data(response)
    assert data["activeCount"] == 2
    assert data["nearestAssignment"]["title"] == "먼저 과제"


def test_authenticated_assignment_lifecycle(client: TestClient) -> None:
    headers, _ = _signup_and_login(client)

    created = _create_via_api(client, headers)
    assert created.status_code == 201
    assignment_id = _data(created)["id"]

    listed = client.get(
        "/assignments?from=2026-08-01&to=2026-08-31",
        headers=headers,
    )
    assert listed.status_code == 200
    assert [item["id"] for item in _data(listed)] == [assignment_id]

    updated = client.patch(
        f"/assignments/{assignment_id}",
        json={"title": "수학 프린트 제출"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert _data(updated)["title"] == "수학 프린트 제출"

    completed = client.put(
        f"/assignments/{assignment_id}/completion",
        json={"completed": True},
        headers=headers,
    )
    assert completed.status_code == 200
    assert _data(completed)["completed"] is True

    dashboard = client.get("/dashboard", headers=headers)
    assert dashboard.status_code == 200
    assert _data(dashboard) == {"activeCount": 0, "nearestAssignment": None}

    deleted = client.delete(f"/assignments/{assignment_id}", headers=headers)
    assert deleted.status_code == 204
    assert (
        client.get(f"/assignments/{assignment_id}", headers=headers).status_code == 404
    )


def test_openapi_exposes_assignment_contract(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]

    assert set(paths["/assignments"]) == {"get", "post"}
    assert set(paths["/assignments/{assignment_id}"]) == {"get", "patch", "delete"}
    assert set(paths["/assignments/{assignment_id}/completion"]) == {"put"}
    assert set(paths["/dashboard"]) == {"get"}
