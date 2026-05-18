"""ParkingService — orchestrates check-in / check-out flows."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.exceptions import (
    TicketAlreadyClosed,
    TicketNotFound,
    VehicleAlreadyParked,
)
from app.models import (
    Floor,
    ParkingSpot,
    ParkingTicket,
    SpotType,
    TicketStatus,
    Vehicle,
    VehicleType,
)
from app.models.enums import SpotStatus
from app.services.allocation_service import AllocationService
from app.services.fee_service import FeeCalculator


class ParkingService:
    def __init__(
        self,
        allocator: AllocationService | None = None,
        fees: FeeCalculator | None = None,
    ) -> None:
        self._allocator = allocator or AllocationService()
        self._fees = fees or FeeCalculator()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    def _get_or_create_vehicle(
        self, db: Session, *, license_plate: str, vehicle_type: VehicleType
    ) -> Vehicle:
        plate = license_plate.strip().upper()
        vehicle = db.execute(
            select(Vehicle).where(Vehicle.license_plate == plate)
        ).scalar_one_or_none()
        if vehicle is not None:
            return vehicle

        vehicle = Vehicle(license_plate=plate, vehicle_type=vehicle_type)
        db.add(vehicle)
        try:
            db.flush()
        except IntegrityError:
            # Another concurrent insert won — re-read.
            db.rollback()
            vehicle = db.execute(
                select(Vehicle).where(Vehicle.license_plate == plate)
            ).scalar_one()
        return vehicle

    def _active_ticket_for_vehicle(
        self, db: Session, vehicle_id: int
    ) -> ParkingTicket | None:
        return db.execute(
            select(ParkingTicket).where(
                ParkingTicket.vehicle_id == vehicle_id,
                ParkingTicket.status == TicketStatus.ACTIVE,
            )
        ).scalar_one_or_none()

    def check_in(
        self,
        db: Session,
        *,
        license_plate: str,
        vehicle_type: VehicleType,
        lot_id: int,
    ) -> ParkingTicket:
        """Allocate a spot and open a ticket. Atomic per-vehicle."""
        vehicle = self._get_or_create_vehicle(
            db, license_plate=license_plate, vehicle_type=vehicle_type
        )

        if self._active_ticket_for_vehicle(db, vehicle.id) is not None:
            raise VehicleAlreadyParked(
                f"Vehicle {vehicle.license_plate} already has an active ticket"
            )

        # AllocationService commits the spot transition. It either succeeds or
        # raises NoSpotAvailable.
        spot = self._allocator.allocate(db, lot_id=lot_id, vehicle_type=vehicle_type)

        ticket = ParkingTicket(
            vehicle_id=vehicle.id,
            spot_id=spot.id,
            entry_time=self._now(),
            status=TicketStatus.ACTIVE,
        )
        db.add(ticket)
        try:
            db.commit()
        except Exception:
            # Compensate: free the spot we just claimed so we don't leak it.
            db.rollback()
            self._allocator.release(db, spot_id=spot.id)
            raise

        db.refresh(ticket)
        return ticket

    def check_out(
        self,
        db: Session,
        *,
        ticket_id: int,
        exit_time: datetime | None = None,
    ) -> ParkingTicket:
        """Close a ticket, compute the fee, and free the spot."""
        ticket = db.get(ParkingTicket, ticket_id)
        if ticket is None:
            raise TicketNotFound(f"Ticket {ticket_id} not found")
        if ticket.status != TicketStatus.ACTIVE:
            raise TicketAlreadyClosed(
                f"Ticket {ticket_id} is not active (status={ticket.status.value})"
            )

        when = exit_time or self._now()
        quote = self._fees.quote(
            vehicle_type=ticket.vehicle.vehicle_type,
            entry_time=ticket.entry_time,
            exit_time=when,
        )

        ticket.exit_time = when
        ticket.amount = quote.amount
        ticket.status = TicketStatus.COMPLETED

        db.commit()

        # Free the spot AFTER the ticket is durably closed, so a crash in
        # between leaves us with an OCCUPIED spot but a COMPLETED ticket
        # (recoverable by a janitor job) — never the inverse, which would
        # double-allocate the spot.
        self._allocator.release(db, spot_id=ticket.spot_id)

        db.refresh(ticket)
        return ticket

    def availability(self, db: Session, lot_id: int) -> dict[SpotType, dict[str, int]]:
        """Return per-spot-type availability for a lot."""
        available_expr = func.sum(
            case((ParkingSpot.status == SpotStatus.AVAILABLE, 1), else_=0)
        )
        stmt = (
            select(
                ParkingSpot.spot_type,
                func.count(ParkingSpot.id).label("total"),
                available_expr.label("available"),
            )
            .join(Floor, ParkingSpot.floor_id == Floor.id)
            .where(Floor.lot_id == lot_id)
            .group_by(ParkingSpot.spot_type)
        )
        rows = db.execute(stmt).all()
        return {
            row.spot_type: {"total": int(row.total or 0), "available": int(row.available or 0)}
            for row in rows
        }
