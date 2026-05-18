"""Pydantic schemas for the public API."""

from app.schemas.parking import (
    AvailabilityResponse,
    AvailabilityRow,
    CheckInRequest,
    CheckInResponse,
    CheckOutRequest,
    CheckOutResponse,
)
from app.schemas.setup import (
    FloorCreate,
    LotCreate,
    LotResponse,
    SpotCreate,
)

__all__ = [
    "AvailabilityResponse",
    "AvailabilityRow",
    "CheckInRequest",
    "CheckInResponse",
    "CheckOutRequest",
    "CheckOutResponse",
    "FloorCreate",
    "LotCreate",
    "LotResponse",
    "SpotCreate",
]
