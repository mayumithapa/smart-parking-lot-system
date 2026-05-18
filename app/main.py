"""FastAPI application entry-point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1 import api_router
from app.config import get_settings
from app.database import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        description=(
            "Backend system for a smart, multi-floor parking lot.\n\n"
            "Features:\n"
            "- Automatic spot allocation by vehicle size with smallest-fit fallback\n"
            "- Concurrency-safe check-in via atomic conditional UPDATE\n"
            "- Hourly fee calculation with minimum charge and daily cap\n"
            "- Real-time per-spot-type availability"
        ),
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", tags=["meta"])
    def root() -> dict[str, object]:
        """Landing route — points the browser at the useful URLs."""
        return {
            "name": settings.app_name,
            "version": "0.1.0",
            "docs": "/docs",
            "redoc": "/redoc",
            "openapi": "/openapi.json",
            "endpoints": {
                "create_lot": "POST /api/v1/admin/lots",
                "check_in": "POST /api/v1/parking/check-in",
                "check_out": "POST /api/v1/parking/check-out",
                "availability": "GET /api/v1/lots/{lot_id}/availability",
            },
        }

    app.include_router(api_router)
    return app


app = create_app()
