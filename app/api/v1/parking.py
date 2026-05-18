"""Check-in / check-out endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.exceptions import ParkingError
from app.schemas import (
    CheckInRequest,
    CheckInResponse,
    CheckOutRequest,
    CheckOutResponse,
)
from app.services.parking_service import ParkingService

router = APIRouter(prefix="/parking", tags=["parking"])


def get_service() -> ParkingService:
    return ParkingService()


@router.post(
    "/check-in",
    response_model=CheckInResponse,
    status_code=status.HTTP_201_CREATED,
)
def check_in(
    payload: CheckInRequest,
    db: Session = Depends(get_db),
    service: ParkingService = Depends(get_service),
) -> CheckInResponse:
    try:
        ticket = service.check_in(
            db,
            license_plate=payload.license_plate,
            vehicle_type=payload.vehicle_type,
            lot_id=payload.lot_id,
        )
    except ParkingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return CheckInResponse(
        ticket_id=ticket.id,
        vehicle_id=ticket.vehicle_id,
        spot_id=ticket.spot_id,
        spot_code=ticket.spot.code,
        floor_number=ticket.spot.floor.number,
        entry_time=ticket.entry_time,
    )


@router.post("/check-out", response_model=CheckOutResponse)
def check_out(
    payload: CheckOutRequest,
    db: Session = Depends(get_db),
    service: ParkingService = Depends(get_service),
) -> CheckOutResponse:
    try:
        ticket = service.check_out(
            db, ticket_id=payload.ticket_id, exit_time=payload.exit_time
        )
    except ParkingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    assert ticket.exit_time is not None and ticket.amount is not None
    duration_minutes = int((ticket.exit_time - ticket.entry_time).total_seconds() // 60)

    return CheckOutResponse(
        ticket_id=ticket.id,
        entry_time=ticket.entry_time,
        exit_time=ticket.exit_time,
        duration_minutes=duration_minutes,
        amount=ticket.amount,
        spot_id=ticket.spot_id,
    )
