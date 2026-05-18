"""Admin endpoints for setting up the parking lot topology."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Floor, ParkingLot, ParkingSpot
from app.schemas import LotCreate, LotResponse

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post(
    "/lots",
    response_model=LotResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_lot(payload: LotCreate, db: Session = Depends(get_db)) -> LotResponse:
    """Create a parking lot, its floors, and all spots in one shot."""
    lot = ParkingLot(name=payload.name, address=payload.address)
    db.add(lot)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Lot name already exists") from exc

    spot_count = 0
    for floor_in in payload.floors:
        floor = Floor(lot_id=lot.id, number=floor_in.number, name=floor_in.name)
        db.add(floor)
        db.flush()
        for spot_in in floor_in.spots:
            db.add(
                ParkingSpot(
                    floor_id=floor.id,
                    code=spot_in.code,
                    spot_type=spot_in.spot_type,
                )
            )
            spot_count += 1

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc.orig)) from exc

    return LotResponse(
        id=lot.id,
        name=lot.name,
        address=lot.address,
        floor_count=len(payload.floors),
        spot_count=spot_count,
    )
