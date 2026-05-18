"""Pydantic schemas for admin/setup endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.enums import SpotType


class SpotCreate(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    spot_type: SpotType


class FloorCreate(BaseModel):
    number: int
    name: str | None = None
    spots: list[SpotCreate] = Field(default_factory=list)


class LotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    address: str | None = None
    floors: list[FloorCreate] = Field(default_factory=list)


class LotResponse(BaseModel):
    id: int
    name: str
    address: str | None
    floor_count: int
    spot_count: int
