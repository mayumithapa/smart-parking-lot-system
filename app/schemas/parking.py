"""Pydantic schemas for check-in / check-out / availability."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import SpotType, VehicleType


class CheckInRequest(BaseModel):
    license_plate: str = Field(min_length=1, max_length=20)
    vehicle_type: VehicleType
    lot_id: int


class CheckInResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticket_id: int
    vehicle_id: int
    spot_id: int
    spot_code: str
    floor_number: int
    entry_time: datetime


class CheckOutRequest(BaseModel):
    ticket_id: int
    # Optional override for testing / corrections; defaults to "now".
    exit_time: datetime | None = None


class CheckOutResponse(BaseModel):
    ticket_id: int
    entry_time: datetime
    exit_time: datetime
    duration_minutes: int
    amount: float
    spot_id: int


class AvailabilityRow(BaseModel):
    spot_type: SpotType
    available: int
    total: int


class AvailabilityResponse(BaseModel):
    lot_id: int
    rows: list[AvailabilityRow]
