import base64
import logging
from datetime import datetime, timezone
from io import BytesIO
from threading import Lock
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo

import openai
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from openai import OpenAI
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)

from app.auth import get_current_user
from app.config import get_settings
from app.models import SubjectCode, User
from app.responses import ApiResponse, ok


router = APIRouter()
logger = logging.getLogger(__name__)
KOREA_ZONE = ZoneInfo("Asia/Seoul")
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_IMAGE_EDGE = 2048
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
ReviewField = Literal["title", "subject", "dueAt"]
OptionalTitle = Annotated[str, StringConstraints(min_length=1, max_length=100)] | None
WarningText = Annotated[str, StringConstraints(min_length=1, max_length=200)]

SYSTEM_PROMPT = """사진에서 고등학생의 과제 정보를 추출하세요.
- 사진에 보이는 정보만 사용하고 불명확한 값은 추측하지 말고 null로 반환하세요.
- 한 사진에 과제가 여러 개면 각각 후보로 반환하되 최대 5개까지만 반환하세요.
- 과제 정보가 하나도 없는 빈 후보나 자리 채우기용 후보는 반환하지 마세요.
- 과목은 KOREAN, ENGLISH, MATH, SOCIAL_STUDIES, SCIENCE, HISTORY, ETC 중 하나입니다.
- 시간이 없고 날짜가 명확하면 그 날짜의 23:59 Asia/Seoul을 사용하세요.
- 연도 또는 날짜가 불명확하면 dueAt을 null로 반환하세요.
- null이거나 사용자가 확인해야 하는 필드는 needsReview에 넣으세요.
- requiresConfirmation은 항상 true입니다.
"""
_request_lock = Lock()
_request_count = 0


class AssignmentCandidate(BaseModel):
    title: OptionalTitle
    subject: SubjectCode | None
    due_at: AwareDatetime | None = Field(alias="dueAt")
    needs_review: list[ReviewField] = Field(alias="needsReview", max_length=3)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("due_at")
    @classmethod
    def normalize_due_at(cls, value: datetime | None) -> datetime | None:
        return value.astimezone(timezone.utc) if value is not None else None

    @field_validator("needs_review")
    @classmethod
    def reject_duplicate_review_fields(
        cls,
        value: list[ReviewField],
    ) -> list[ReviewField]:
        if len(value) != len(set(value)):
            raise ValueError("needsReview must not contain duplicates")
        return value

    @model_validator(mode="after")
    def require_review_for_missing_values(self) -> Self:
        missing = {
            field
            for field, value in (
                ("title", self.title),
                ("subject", self.subject),
                ("dueAt", self.due_at),
            )
            if value is None
        }
        if not missing.issubset(self.needs_review):
            raise ValueError("missing values must be included in needsReview")
        return self


class AssignmentExtraction(BaseModel):
    candidates: list[AssignmentCandidate] = Field(max_length=5)
    requires_confirmation: Literal[True] = Field(alias="requiresConfirmation")
    warnings: list[WarningText] = Field(max_length=5)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("candidates")
    @classmethod
    def remove_empty_candidates(
        cls,
        value: list[AssignmentCandidate],
    ) -> list[AssignmentCandidate]:
        return [
            candidate
            for candidate in value
            if any(
                item is not None
                for item in (candidate.title, candidate.subject, candidate.due_at)
            )
        ]


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _invalid_image() -> HTTPException:
    return _error(
        status.HTTP_400_BAD_REQUEST,
        "INVALID_IMAGE",
        "지원하지 않거나 올바르지 않은 이미지입니다.",
    )


def prepare_image(content: bytes, content_type: str) -> bytes:
    if (
        not content
        or len(content) > MAX_FILE_BYTES
        or content_type not in ALLOWED_CONTENT_TYPES
    ):
        raise _invalid_image()

    try:
        with Image.open(BytesIO(content)) as probe:
            if (
                probe.format not in ALLOWED_IMAGE_FORMATS
                or probe.width * probe.height > MAX_IMAGE_PIXELS
            ):
                raise _invalid_image()
            probe.verify()

        with Image.open(BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source)
            image.thumbnail(
                (MAX_IMAGE_EDGE, MAX_IMAGE_EDGE),
                Image.Resampling.LANCZOS,
            )
            output = BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=85, optimize=True)
            return output.getvalue()
    except Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError:
        raise _invalid_image() from None


def _claim_openai_request(limit: int) -> None:
    global _request_count
    # ponytail: single-process PoC cap; use a persistent per-user quota before scaling.
    with _request_lock:
        if _request_count >= limit:
            raise _error(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "AI_RATE_LIMITED",
                "사진 분석 사용량이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
            )
        _request_count += 1


def extract_with_openai(image: bytes) -> AssignmentExtraction:
    settings = get_settings()
    if not settings.ai_extraction_enabled or settings.openai_api_key is None:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI_EXTRACTION_DISABLED",
            "사진 자동 추출 기능을 사용할 수 없습니다.",
        )

    _claim_openai_request(settings.openai_max_requests)
    encoded_image = base64.b64encode(image).decode("ascii")
    client = OpenAI(
        api_key=settings.openai_api_key.get_secret_value(),
        max_retries=0,
        timeout=20.0,
    )
    try:
        response = client.responses.parse(
            model=settings.openai_model,
            instructions=SYSTEM_PROMPT,
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "현재 기준 시각은 "
                                f"{datetime.now(KOREA_ZONE).isoformat()}입니다."
                            ),
                        },
                        {
                            "type": "input_image",
                            "image_url": f"data:image/jpeg;base64,{encoded_image}",
                            "detail": settings.openai_image_detail,
                        },
                    ],
                }
            ],
            text_format=AssignmentExtraction,
            reasoning={"effort": "minimal"},
            max_output_tokens=settings.openai_max_output_tokens,
            store=False,
        )
    except openai.RateLimitError as exc:
        logger.warning("OpenAI extraction rate limited: %s", type(exc).__name__)
        raise _error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "AI_RATE_LIMITED",
            "사진 분석 사용량이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
        ) from None
    except (openai.OpenAIError, ValidationError) as exc:
        logger.warning("OpenAI extraction failed: %s", type(exc).__name__)
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            "AI_EXTRACTION_FAILED",
            "사진에서 과제 정보를 추출하지 못했습니다.",
        ) from None

    if response.output_parsed is None:
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            "AI_EXTRACTION_FAILED",
            "사진에서 과제 정보를 추출하지 못했습니다.",
        )
    return response.output_parsed


@router.post(
    "/assignment-extractions",
    response_model=ApiResponse[AssignmentExtraction],
    response_model_by_alias=True,
    tags=["assignment-extractions"],
)
def extract_assignments(
    image: Annotated[UploadFile, File(description="과제 안내 이미지")],
    _user: User = Depends(get_current_user),
) -> ApiResponse[AssignmentExtraction]:
    content = image.file.read(MAX_FILE_BYTES + 1)
    prepared = prepare_image(content, image.content_type or "")
    return ok(extract_with_openai(prepared))
