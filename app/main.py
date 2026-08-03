from fastapi import FastAPI, Response
from sqlalchemy.exc import SQLAlchemyError

from app.db import check_database

app = FastAPI(title="RECORDS API")


@app.get("/health/live", tags=["health"])
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def readiness(response: Response) -> dict[str, str]:
    try:
        check_database()
    except SQLAlchemyError:
        response.status_code = 503
        return {"status": "not_ready"}
    return {"status": "ready"}
