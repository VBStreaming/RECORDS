from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Self
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import Assignment, SubjectCode, User


router = APIRouter()
KOREA_ZONE = ZoneInfo("Asia/Seoul")
UTC = timezone.utc
Title = Annotated[str, StringConstraints(min_length=1, max_length=100)]


class AssignmentCreate(BaseModel):
    title: Title
    subject: SubjectCode
    due_at: AwareDatetime = Field(alias="dueAt")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return value.strip()


class AssignmentUpdate(BaseModel):
    title: Title | None = None
    subject: SubjectCode | None = None
    due_at: AwareDatetime | None = Field(default=None, alias="dueAt")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def validate_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("updated fields must not be null")
        return self


class CompletionRequest(BaseModel):
    completed: bool

    model_config = ConfigDict(extra="forbid")


class AssignmentListQuery(BaseModel):
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    completed: bool | None = None

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @model_validator(mode="after")
    def validate_range(self) -> Self:
        if self.start > self.end:
            raise ValueError("from must be on or before to")
        if (self.end - self.start).days >= 62:
            raise ValueError("date range must not exceed 62 days")
        return self


class AssignmentResponse(BaseModel):
    id: UUID
    title: str
    subject: SubjectCode
    due_at: datetime = Field(alias="dueAt")
    completed: bool
    completed_at: datetime | None = Field(alias="completedAt")
    day_offset: int = Field(alias="dayOffset")
    deadline_label: str = Field(alias="deadlineLabel")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class DashboardResponse(BaseModel):
    active_count: int = Field(alias="activeCount")
    nearest_assignment: AssignmentResponse | None = Field(alias="nearestAssignment")

    model_config = ConfigDict(populate_by_name=True)


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _deadline(due_at: datetime, now: datetime) -> tuple[int, str]:
    day_offset = (
        due_at.astimezone(KOREA_ZONE).date() - now.astimezone(KOREA_ZONE).date()
    ).days
    if day_offset > 0:
        return day_offset, f"D-{day_offset}"
    if day_offset == 0:
        return 0, "D-Day"
    return day_offset, f"{-day_offset}일 지남"


def _assignment_response(
    assignment: Assignment,
    *,
    now: datetime | None = None,
) -> AssignmentResponse:
    day_offset, deadline_label = _deadline(assignment.due_at, now or _now_utc())
    return AssignmentResponse(
        id=assignment.id,
        title=assignment.title,
        subject=SubjectCode(assignment.subject),
        dueAt=assignment.due_at.astimezone(UTC),
        completed=assignment.completed_at is not None,
        completedAt=(
            assignment.completed_at.astimezone(UTC)
            if assignment.completed_at is not None
            else None
        ),
        dayOffset=day_offset,
        deadlineLabel=deadline_label,
        createdAt=assignment.created_at.astimezone(UTC),
        updatedAt=assignment.updated_at.astimezone(UTC),
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "ASSIGNMENT_NOT_FOUND", "message": "과제를 찾을 수 없습니다."},
    )


def _owned_assignment(db: Session, assignment_id: UUID, user_id: UUID) -> Assignment:
    assignment = db.scalar(
        select(Assignment).where(
            Assignment.id == assignment_id,
            Assignment.user_id == user_id,
        )
    )
    if assignment is None:
        raise _not_found()
    return assignment


@router.post(
    "/assignments",
    response_model=AssignmentResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    tags=["assignments"],
)
def create_assignment(
    request: AssignmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentResponse:
    assignment = Assignment(
        user_id=user.id,
        title=request.title,
        subject=request.subject.value,
        due_at=request.due_at.astimezone(UTC),
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return _assignment_response(assignment)


@router.get(
    "/assignments",
    response_model=list[AssignmentResponse],
    response_model_by_alias=True,
    tags=["assignments"],
)
def list_assignments(
    filters: Annotated[AssignmentListQuery, Query()],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AssignmentResponse]:
    start_at = datetime.combine(filters.start, time.min, KOREA_ZONE).astimezone(UTC)
    end_at = datetime.combine(
        filters.end + timedelta(days=1), time.min, KOREA_ZONE
    ).astimezone(UTC)
    statement = select(Assignment).where(
        Assignment.user_id == user.id,
        Assignment.due_at >= start_at,
        Assignment.due_at < end_at,
    )
    if filters.completed is True:
        statement = statement.where(Assignment.completed_at.is_not(None))
    elif filters.completed is False:
        statement = statement.where(Assignment.completed_at.is_(None))

    completion_group = case((Assignment.completed_at.is_(None), 0), else_=1)
    incomplete_due_at = case(
        (Assignment.completed_at.is_(None), Assignment.due_at)
    )
    completed_at = case(
        (Assignment.completed_at.is_not(None), Assignment.completed_at)
    )
    assignments = db.scalars(
        statement.order_by(
            completion_group,
            incomplete_due_at.asc(),
            completed_at.desc(),
            Assignment.id.asc(),
        )
    ).all()
    now = _now_utc()
    return [_assignment_response(assignment, now=now) for assignment in assignments]


@router.get(
    "/assignments/{assignment_id}",
    response_model=AssignmentResponse,
    response_model_by_alias=True,
    tags=["assignments"],
)
def get_assignment(
    assignment_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentResponse:
    return _assignment_response(_owned_assignment(db, assignment_id, user.id))


@router.patch(
    "/assignments/{assignment_id}",
    response_model=AssignmentResponse,
    response_model_by_alias=True,
    tags=["assignments"],
)
def update_assignment(
    assignment_id: UUID,
    request: AssignmentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentResponse:
    assignment = _owned_assignment(db, assignment_id, user.id)
    changed = False

    if "title" in request.model_fields_set and assignment.title != request.title:
        assignment.title = request.title
        changed = True
    if "subject" in request.model_fields_set and assignment.subject != request.subject:
        assignment.subject = request.subject.value
        changed = True
    if "due_at" in request.model_fields_set:
        due_at = request.due_at.astimezone(UTC)
        if assignment.due_at != due_at:
            assignment.due_at = due_at
            changed = True

    now = _now_utc()
    if changed:
        assignment.updated_at = now
        db.commit()
        db.refresh(assignment)
    return _assignment_response(assignment, now=now)


@router.put(
    "/assignments/{assignment_id}/completion",
    response_model=AssignmentResponse,
    response_model_by_alias=True,
    tags=["assignments"],
)
def set_assignment_completion(
    assignment_id: UUID,
    request: CompletionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentResponse:
    assignment = _owned_assignment(db, assignment_id, user.id)
    now = _now_utc()
    is_completed = assignment.completed_at is not None
    if request.completed != is_completed:
        assignment.completed_at = now if request.completed else None
        assignment.updated_at = now
        db.commit()
        db.refresh(assignment)
    return _assignment_response(assignment, now=now)


@router.delete(
    "/assignments/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["assignments"],
)
def delete_assignment(
    assignment_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    assignment = _owned_assignment(db, assignment_id, user.id)
    db.delete(assignment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    response_model_by_alias=True,
    tags=["assignments"],
)
def dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    active_conditions = (
        Assignment.user_id == user.id,
        Assignment.completed_at.is_(None),
    )
    active_count = db.scalar(
        select(func.count(Assignment.id)).where(*active_conditions)
    )
    now = _now_utc()
    nearest = db.scalar(
        select(Assignment)
        .where(*active_conditions, Assignment.due_at < now)
        .order_by(Assignment.due_at.desc(), Assignment.id.asc())
        .limit(1)
    )
    if nearest is None:
        nearest = db.scalar(
            select(Assignment)
            .where(*active_conditions, Assignment.due_at >= now)
            .order_by(Assignment.due_at.asc(), Assignment.id.asc())
            .limit(1)
        )
    return DashboardResponse(
        activeCount=active_count or 0,
        nearestAssignment=(
            _assignment_response(nearest, now=now) if nearest is not None else None
        ),
    )
