"""Spot allocation algorithm tests."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.exceptions import NoSpotAvailable, VehicleAlreadyParked
from app.models import ParkingSpot, TicketStatus, Vehicle
from app.models.enums import SpotStatus, SpotType, VehicleType
from app.services.allocation_service import AllocationService
from app.services.parking_service import ParkingService


def test_motorcycle_takes_motorcycle_spot_first(db, seeded_lot):
    service = ParkingService()
    ticket = service.check_in(
        db,
        license_plate="M-AAA-1",
        vehicle_type=VehicleType.MOTORCYCLE,
        lot_id=seeded_lot.id,
    )
    assert ticket.spot.spot_type == SpotType.MOTORCYCLE


def test_car_takes_compact_spot_first(db, seeded_lot):
    service = ParkingService()
    ticket = service.check_in(
        db,
        license_plate="CAR-1",
        vehicle_type=VehicleType.CAR,
        lot_id=seeded_lot.id,
    )
    assert ticket.spot.spot_type == SpotType.COMPACT


def test_bus_takes_large_spot(db, seeded_lot):
    service = ParkingService()
    ticket = service.check_in(
        db,
        license_plate="BUS-1",
        vehicle_type=VehicleType.BUS,
        lot_id=seeded_lot.id,
    )
    assert ticket.spot.spot_type == SpotType.LARGE


def test_car_falls_back_to_large_when_no_compact(db, seeded_lot):
    """When all COMPACT spots are taken, a CAR should park in a LARGE spot."""
    # Manually mark all compact spots as occupied.
    for spot in db.execute(
        select(ParkingSpot).where(ParkingSpot.spot_type == SpotType.COMPACT)
    ).scalars():
        spot.status = SpotStatus.OCCUPIED
    db.commit()

    service = ParkingService()
    ticket = service.check_in(
        db,
        license_plate="CAR-OVERFLOW",
        vehicle_type=VehicleType.CAR,
        lot_id=seeded_lot.id,
    )
    assert ticket.spot.spot_type == SpotType.LARGE


def test_bus_does_not_use_smaller_spots(db, seeded_lot):
    """Buses must NEVER fit into compact/motorcycle spots."""
    for spot in db.execute(
        select(ParkingSpot).where(ParkingSpot.spot_type == SpotType.LARGE)
    ).scalars():
        spot.status = SpotStatus.OCCUPIED
    db.commit()

    service = ParkingService()
    with pytest.raises(NoSpotAvailable):
        service.check_in(
            db,
            license_plate="BUS-2",
            vehicle_type=VehicleType.BUS,
            lot_id=seeded_lot.id,
        )


def test_lot_full_raises(db, seeded_lot):
    """Once everything is OCCUPIED, allocation must raise."""
    for spot in db.execute(select(ParkingSpot)).scalars():
        spot.status = SpotStatus.OCCUPIED
    db.commit()

    allocator = AllocationService()
    with pytest.raises(NoSpotAvailable):
        allocator.allocate(db, lot_id=seeded_lot.id, vehicle_type=VehicleType.CAR)


def test_double_check_in_blocked(db, seeded_lot):
    service = ParkingService()
    service.check_in(
        db,
        license_plate="DUPE-1",
        vehicle_type=VehicleType.CAR,
        lot_id=seeded_lot.id,
    )
    with pytest.raises(VehicleAlreadyParked):
        service.check_in(
            db,
            license_plate="DUPE-1",
            vehicle_type=VehicleType.CAR,
            lot_id=seeded_lot.id,
        )


def test_check_out_frees_spot(db, seeded_lot):
    service = ParkingService()
    ticket = service.check_in(
        db,
        license_plate="FREE-1",
        vehicle_type=VehicleType.CAR,
        lot_id=seeded_lot.id,
    )
    spot_id = ticket.spot_id

    closed = service.check_out(db, ticket_id=ticket.id)
    assert closed.status == TicketStatus.COMPLETED
    assert closed.amount is not None and closed.amount > 0

    refreshed_spot = db.get(ParkingSpot, spot_id)
    assert refreshed_spot is not None
    assert refreshed_spot.status == SpotStatus.AVAILABLE


def test_vehicle_record_reused_across_visits(db, seeded_lot):
    service = ParkingService()
    t1 = service.check_in(
        db,
        license_plate="reuse-1",
        vehicle_type=VehicleType.CAR,
        lot_id=seeded_lot.id,
    )
    service.check_out(db, ticket_id=t1.id)
    t2 = service.check_in(
        db,
        license_plate="REUSE-1",  # case-insensitive normalization
        vehicle_type=VehicleType.CAR,
        lot_id=seeded_lot.id,
    )
    assert t1.vehicle_id == t2.vehicle_id

    vehicles = db.execute(select(Vehicle)).scalars().all()
    assert sum(v.license_plate == "REUSE-1" for v in vehicles) == 1
