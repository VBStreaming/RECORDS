from typing import Generic, Literal, TypeVar

from pydantic import BaseModel


T = TypeVar("T")


class ValidationDetail(BaseModel):
    field: str
    message: str
    type: str


class ApiError(BaseModel):
    code: str
    message: str
    details: list[ValidationDetail] | None = None


class ApiResponse(BaseModel, Generic[T]):
    success: Literal[True] = True
    data: T
    error: None = None


class ApiErrorResponse(BaseModel):
    success: Literal[False] = False
    data: None = None
    error: ApiError


COMMON_ERROR_RESPONSES = {
    400: {"model": ApiErrorResponse, "description": "Bad request"},
    401: {"model": ApiErrorResponse, "description": "Authentication failed"},
    403: {"model": ApiErrorResponse, "description": "Forbidden"},
    404: {"model": ApiErrorResponse, "description": "Not found"},
    405: {"model": ApiErrorResponse, "description": "Method not allowed"},
    409: {"model": ApiErrorResponse, "description": "Conflict"},
    422: {"model": ApiErrorResponse, "description": "Validation failed"},
    500: {"model": ApiErrorResponse, "description": "Internal server error"},
    503: {"model": ApiErrorResponse, "description": "Database unavailable"},
}


def ok(data: T) -> ApiResponse[T]:
    return ApiResponse(data=data)
