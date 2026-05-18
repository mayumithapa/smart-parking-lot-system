"""API v1 router aggregation."""

from fastapi import APIRouter

from app.api.v1 import admin, parking, spots

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(admin.router)
api_router.include_router(parking.router)
api_router.include_router(spots.router)
