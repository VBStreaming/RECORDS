import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.responses import ApiError, ApiErrorResponse, ValidationDetail


logger = logging.getLogger(__name__)

HTTP_ERROR_DEFAULTS = {
    400: ("BAD_REQUEST", "잘못된 요청입니다."),
    401: ("UNAUTHORIZED", "인증이 필요합니다."),
    403: ("FORBIDDEN", "요청을 수행할 권한이 없습니다."),
    404: ("NOT_FOUND", "요청한 API를 찾을 수 없습니다."),
    405: ("METHOD_NOT_ALLOWED", "허용되지 않은 HTTP 메서드입니다."),
    409: ("CONFLICT", "요청이 현재 상태와 충돌합니다."),
}


def _error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[ValidationDetail] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = ApiErrorResponse(
        error=ApiError(code=code, message=message, details=details)
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json"),
        headers=headers,
    )


async def http_exception_handler(
    _request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    default_code, default_message = HTTP_ERROR_DEFAULTS.get(
        exc.status_code,
        ("HTTP_ERROR", "요청을 처리할 수 없습니다."),
    )
    if isinstance(exc.detail, dict):
        code = str(exc.detail.get("code", default_code))
        message = str(exc.detail.get("message", default_message))
    else:
        code = default_code
        message = default_message
    return _error_response(
        exc.status_code,
        code,
        message,
        headers=exc.headers,
    )


async def validation_exception_handler(
    _request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    details = [
        ValidationDetail(
            field=".".join(str(part) for part in error["loc"]),
            message=error["msg"],
            type=error["type"],
        )
        for error in exc.errors()
    ]
    return _error_response(
        422,
        "VALIDATION_ERROR",
        "요청 값이 올바르지 않습니다.",
        details=details,
    )


async def database_exception_handler(
    _request: Request,
    exc: SQLAlchemyError,
) -> JSONResponse:
    logger.error("Database request failed", exc_info=exc)
    return _error_response(
        503,
        "DATABASE_UNAVAILABLE",
        "데이터베이스에 일시적으로 연결할 수 없습니다.",
    )


async def unhandled_exception_handler(
    _request: Request,
    exc: Exception,
) -> JSONResponse:
    logger.error("Unhandled request error", exc_info=exc)
    return _error_response(
        500,
        "INTERNAL_SERVER_ERROR",
        "서버 내부 오류가 발생했습니다.",
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(SQLAlchemyError, database_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
