from fastapi import FastAPI

from app.assignments import router as assignments_router
from app.auth import router as auth_router
from app.db import check_database
from app.exceptions import register_exception_handlers
from app.extractions import router as extractions_router
from app.responses import ApiResponse, COMMON_ERROR_RESPONSES, ok

app = FastAPI(title="RECORDS API", responses=COMMON_ERROR_RESPONSES)
register_exception_handlers(app)
app.include_router(auth_router)
app.include_router(assignments_router)
app.include_router(extractions_router)


@app.get("/health/live", response_model=ApiResponse[dict[str, str]], tags=["health"])
def liveness() -> ApiResponse[dict[str, str]]:
    return ok({"status": "ok"})


@app.get("/health/ready", response_model=ApiResponse[dict[str, str]], tags=["health"])
def readiness() -> ApiResponse[dict[str, str]]:
    check_database()
    return ok({"status": "ready"})
