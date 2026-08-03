from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

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
