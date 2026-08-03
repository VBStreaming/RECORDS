from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.config import get_settings
from app.db import get_db
from app.models import User


router = APIRouter()
password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)
ACCESS_TOKEN_SECONDS = 30 * 60

Name = Annotated[str, StringConstraints(min_length=1, max_length=50)]
StudentNumber = Annotated[str, StringConstraints(pattern=r"^[0-9]{5}$")]
Password = Annotated[str, StringConstraints(min_length=10, max_length=128)]


class SignupRequest(BaseModel):
    name: Name
    email: Annotated[EmailStr, Field(max_length=254)]
    student_number: StudentNumber = Field(alias="studentNumber")
    password: Password

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserResponse(BaseModel):
    id: UUID
    name: str
    email: str
    student_number: str = Field(alias="studentNumber")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TokenResponse(BaseModel):
    access_token: str = Field(alias="accessToken")
    token_type: str = Field(alias="tokenType")
    expires_in: int = Field(alias="expiresIn")

    model_config = ConfigDict(populate_by_name=True)


def _error(code: str, message: str, status_code: int) -> HTTPException:
    headers = {"WWW-Authenticate": "Bearer"} if status_code == 401 else None
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
        headers=headers,
    )


def _jwt_secret_key() -> str:
    secret_key = get_settings().jwt_secret_key
    if secret_key is None:
        raise RuntimeError("JWT_SECRET_KEY is required")
    return secret_key


def _user_response(user: User) -> UserResponse:
    return UserResponse.model_validate(user, from_attributes=True)


def create_access_token(user_id: UUID) -> str:
    issued_at = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": issued_at + timedelta(seconds=ACCESS_TOKEN_SECONDS),
    }
    return jwt.encode(payload, _jwt_secret_key(), algorithm="HS256")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _error("INVALID_TOKEN", "유효하지 않은 인증 토큰입니다.", 401)

    try:
        payload = jwt.decode(
            credentials.credentials,
            _jwt_secret_key(),
            algorithms=["HS256"],
            options={"require": ["sub", "iat", "exp"]},
        )
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError, jwt.InvalidTokenError, RuntimeError):
        raise _error("INVALID_TOKEN", "유효하지 않은 인증 토큰입니다.", 401) from None

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise _error("INVALID_TOKEN", "유효하지 않은 인증 토큰입니다.", 401)
    return user


@router.post(
    "/auth/signup",
    response_model=UserResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    tags=["auth"],
)
def signup(request: SignupRequest, db: Session = Depends(get_db)) -> UserResponse:
    user = User(
        name=request.name,
        email=str(request.email).lower(),
        student_number=request.student_number,
        password_hash=password_hash.hash(request.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _error(
            "EMAIL_ALREADY_EXISTS",
            "이미 사용 중인 이메일입니다.",
            status.HTTP_409_CONFLICT,
        ) from None
    db.refresh(user)
    return _user_response(user)


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    response_model_by_alias=True,
    tags=["auth"],
)
def login(request: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == str(request.email).lower()))
    if user is None or not password_hash.verify(request.password, user.password_hash):
        raise _error(
            "INVALID_CREDENTIALS",
            "이메일 또는 비밀번호가 올바르지 않습니다.",
            status.HTTP_401_UNAUTHORIZED,
        )

    return TokenResponse(
        accessToken=create_access_token(user.id),
        tokenType="bearer",
        expiresIn=ACCESS_TOKEN_SECONDS,
    )


@router.get(
    "/users/me",
    response_model=UserResponse,
    response_model_by_alias=True,
    tags=["users"],
)
def current_user(user: User = Depends(get_current_user)) -> UserResponse:
    return _user_response(user)
