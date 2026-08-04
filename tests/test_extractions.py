from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import main
from app import extractions as extraction_module
from app.db import get_db
from app.extractions import (
    AssignmentCandidate,
    AssignmentExtraction,
    prepare_image,
)
from app.models import Assignment, SubjectCode


@pytest.fixture
def client(db_session: Session):
    main.app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _image_bytes(
    *,
    image_format: str = "PNG",
    size: tuple[int, int] = (640, 480),
    exif: Image.Exif | None = None,
) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "white").save(output, format=image_format, exif=exif)
    return output.getvalue()


def _auth_headers(client: TestClient) -> dict[str, str]:
    signup = client.post(
        "/auth/signup",
        json={
            "name": "테스트학생",
            "email": "extraction-owner@example.com",
            "studentNumber": "10311",
            "password": "example-password",
        },
    )
    assert signup.status_code == 201
    login = client.post(
        "/auth/login",
        json={
            "email": "extraction-owner@example.com",
            "password": "example-password",
        },
    )
    assert login.status_code == 200
    token = login.json()["data"]["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_prepare_image_reencodes_resizes_and_removes_exif() -> None:
    exif = Image.Exif()
    exif[0x010E] = "private classroom metadata"

    prepared = prepare_image(_image_bytes(size=(3000, 1500), exif=exif), "image/png")

    with Image.open(BytesIO(prepared)) as image:
        assert image.format == "JPEG"
        assert image.size == (2048, 1024)
        assert not image.getexif()


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b"not an image", "image/jpeg"),
        (_image_bytes(), "application/octet-stream"),
        (b"x" * (5 * 1024 * 1024 + 1), "image/png"),
    ],
)
def test_prepare_image_rejects_invalid_uploads(
    content: bytes,
    content_type: str,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        prepare_image(content, content_type)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INVALID_IMAGE"


def test_candidate_requires_review_for_values_model_could_not_read() -> None:
    with pytest.raises(ValidationError):
        AssignmentCandidate(
            title="영어 에세이",
            subject=SubjectCode.ENGLISH,
            dueAt=None,
            needsReview=[],
        )


def test_extraction_removes_empty_placeholder_candidates() -> None:
    extraction = AssignmentExtraction(
        candidates=[
            AssignmentCandidate(
                title="수학 프린트 3장",
                subject=SubjectCode.MATH,
                dueAt="2026-08-11T23:59:00+09:00",
                needsReview=[],
            ),
            AssignmentCandidate(
                title=None,
                subject=None,
                dueAt=None,
                needsReview=["title", "subject", "dueAt"],
            ),
        ],
        requiresConfirmation=True,
        warnings=[],
    )

    assert len(extraction.candidates) == 1
    assert extraction.candidates[0].title == "수학 프린트 3장"


def test_extraction_requires_authentication(client: TestClient) -> None:
    response = client.post(
        "/assignment-extractions",
        files={"image": ("assignment.png", _image_bytes(), "image/png")},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_TOKEN"


def test_extraction_returns_candidates_without_creating_assignments(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _auth_headers(client)
    assignment_count = db_session.scalar(select(func.count()).select_from(Assignment))
    extracted = AssignmentExtraction(
        candidates=[
            AssignmentCandidate(
                title="수학 프린트 3장",
                subject=SubjectCode.MATH,
                dueAt="2026-08-11T23:59:00+09:00",
                needsReview=[],
            )
        ],
        requiresConfirmation=True,
        warnings=[],
    )
    monkeypatch.setattr(
        extraction_module,
        "extract_with_openai",
        lambda _image: extracted,
    )

    response = client.post(
        "/assignment-extractions",
        headers=headers,
        files={"image": ("assignment.png", _image_bytes(), "image/png")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {
            "candidates": [
                {
                    "title": "수학 프린트 3장",
                    "subject": "MATH",
                    "dueAt": "2026-08-11T14:59:00Z",
                    "needsReview": [],
                }
            ],
            "requiresConfirmation": True,
            "warnings": [],
        },
        "error": None,
    }
    assert (
        db_session.scalar(select(func.count()).select_from(Assignment))
        == assignment_count
    )


def test_extraction_preserves_stable_upstream_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _auth_headers(client)

    def fail(_image: bytes) -> AssignmentExtraction:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_EXTRACTION_FAILED",
                "message": "사진에서 과제 정보를 추출하지 못했습니다.",
            },
        )

    monkeypatch.setattr(extraction_module, "extract_with_openai", fail)

    response = client.post(
        "/assignment-extractions",
        headers=headers,
        files={"image": ("assignment.png", _image_bytes(), "image/png")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_EXTRACTION_FAILED"


def test_openai_request_uses_cost_and_privacy_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extracted = AssignmentExtraction(
        candidates=[],
        requiresConfirmation=True,
        warnings=["과제 정보를 찾지 못했습니다."],
    )
    captured: dict[str, object] = {}

    class FakeResponses:
        def parse(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_parsed=extracted)

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs
            self.responses = FakeResponses()

    settings = SimpleNamespace(
        ai_extraction_enabled=True,
        openai_api_key=SecretStr("test-only-key"),
        openai_model="gpt-5-nano",
        openai_image_detail="high",
        openai_max_output_tokens=400,
        openai_max_requests=14,
    )
    monkeypatch.setattr(extraction_module, "get_settings", lambda: settings)
    monkeypatch.setattr(extraction_module, "OpenAI", FakeClient)
    monkeypatch.setattr(extraction_module, "_request_count", 0)

    result = extraction_module.extract_with_openai(b"sanitized-image")

    assert result is extracted
    assert captured["client"] == {
        "api_key": "test-only-key",
        "max_retries": 0,
        "timeout": 20.0,
    }
    assert captured["model"] == "gpt-5-nano"
    assert captured["reasoning"] == {"effort": "minimal"}
    assert captured["max_output_tokens"] == 400
    assert captured["store"] is False
    content = captured["input"][0]["content"]
    assert content[1]["detail"] == "high"


def test_openai_request_stops_at_process_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        ai_extraction_enabled=True,
        openai_api_key=SecretStr("test-only-key"),
        openai_max_requests=14,
    )
    monkeypatch.setattr(extraction_module, "get_settings", lambda: settings)
    monkeypatch.setattr(extraction_module, "_request_count", 14)

    with pytest.raises(HTTPException) as exc_info:
        extraction_module.extract_with_openai(b"sanitized-image")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail["code"] == "AI_RATE_LIMITED"
