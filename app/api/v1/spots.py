"""Real-time spot availability endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.enums import SpotType
from app.schemas import AvailabilityResponse, AvailabilityRow
from app.services.parking_service import ParkingService

router = APIRouter(prefix="/lots/{lot_id}", tags=["availability"])


def get_service() -> ParkingService:
    return ParkingService()


@router.get("/availability", response_model=AvailabilityResponse)
def get_availability(
    lot_id: int,
    db: Session = Depends(get_db),
    service: ParkingService = Depends(get_service),
) -> AvailabilityResponse:
    counts = service.availability(db, lot_id=lot_id)
    rows = [
        AvailabilityRow(
            spot_type=spot_type,
            available=counts.get(spot_type, {}).get("available", 0),
            total=counts.get(spot_type, {}).get("total", 0),
        )
        for spot_type in SpotType
    ]
    return AvailabilityResponse(lot_id=lot_id, rows=rows)
