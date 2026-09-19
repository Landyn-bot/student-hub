from fastapi import FastAPI
from pydantic import BaseModel

from app.config import settings


class HealthResponse(BaseModel):
    status: str


app = FastAPI(title=settings.app_name)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")
