from fastapi import FastAPI

app = FastAPI(title="RECORDS API")


@app.get("/health/live", tags=["health"])
def liveness() -> dict[str, str]:
    return {"status": "ok"}
