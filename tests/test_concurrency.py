"""Concurrency tests for spot allocation.

We launch many threads that all try to check in at the same instant and
verify that:

  * Every successful check-in maps to a *unique* spot.
  * The number of successes equals min(N_threads, free_compact_spots).
  * The remaining failures all raise ``NoSpotAvailable``.

A ``threading.Barrier`` is used to maximise the chance of true racing.
"""

from __future__ import annotations

import threading

from sqlalchemy import select

from app.exceptions import NoSpotAvailable
from app.models import Floor, ParkingLot, ParkingSpot, ParkingTicket, TicketStatus
from app.models.enums import SpotStatus, SpotType, VehicleType
from app.services.parking_service import ParkingService


def _build_lot(session_factory, *, compact_spots: int) -> int:
    """Create a lot with exactly ``compact_spots`` compact spots."""
    sess = session_factory()
    lot = ParkingLot(name=f"Race Lot {compact_spots}")
    sess.add(lot)
    sess.flush()
    floor = Floor(lot_id=lot.id, number=1)
    sess.add(floor)
    sess.flush()
    for i in range(compact_spots):
        sess.add(
            ParkingSpot(
                floor_id=floor.id,
                code=f"C-{i:03d}",
                spot_type=SpotType.COMPACT,
            )
        )
    sess.commit()
    lot_id = lot.id
    sess.close()
    return lot_id


def _check_in_worker(
    session_factory,
    lot_id: int,
    plate: str,
    barrier: threading.Barrier,
    results: list,
) -> None:
    sess = session_factory()
    service = ParkingService()
    barrier.wait()
    try:
        ticket = service.check_in(
            sess,
            license_plate=plate,
            vehicle_type=VehicleType.CAR,
            lot_id=lot_id,
        )
        results.append(("OK", plate, ticket.spot_id))
    except NoSpotAvailable:
        results.append(("FULL", plate, None))
    except Exception as exc:  # surface unexpected failures
        results.append(("ERR", plate, repr(exc)))
    finally:
        sess.close()


def test_no_double_allocation_under_contention(session_factory):
    """50 cars race for 10 compact spots: exactly 10 must succeed, all unique."""
    n_threads = 50
    capacity = 10
    lot_id = _build_lot(session_factory, compact_spots=capacity)

    barrier = threading.Barrier(n_threads)
    results: list = []
    threads = [
        threading.Thread(
            target=_check_in_worker,
            args=(session_factory, lot_id, f"RACE-{i:03d}", barrier, results),
        )
        for i in range(n_threads)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    successes = [r for r in results if r[0] == "OK"]
    fulls = [r for r in results if r[0] == "FULL"]
    errors = [r for r in results if r[0] == "ERR"]

    assert errors == [], f"Unexpected errors: {errors}"
    assert len(successes) == capacity
    assert len(fulls) == n_threads - capacity

    spot_ids = [r[2] for r in successes]
    assert len(spot_ids) == len(set(spot_ids)), "A spot was double-allocated!"

    # Every spot must now be OCCUPIED with exactly one ACTIVE ticket each.
    sess = session_factory()
    try:
        spots = (
            sess.execute(
                select(ParkingSpot)
                .join(Floor, ParkingSpot.floor_id == Floor.id)
                .where(Floor.lot_id == lot_id)
            )
            .scalars()
            .all()
        )
        assert all(s.status == SpotStatus.OCCUPIED for s in spots)

        active = (
            sess.execute(
                select(ParkingTicket).where(ParkingTicket.status == TicketStatus.ACTIVE)
            )
            .scalars()
            .all()
        )
        assert len(active) == capacity
        assert len({t.spot_id for t in active}) == capacity
    finally:
        sess.close()


def test_check_in_check_out_loop_is_consistent(session_factory):
    """Repeated cycles of check-in/check-out preserve invariants."""
    lot_id = _build_lot(session_factory, compact_spots=3)

    sess = session_factory()
    service = ParkingService()
    try:
        for cycle in range(20):
            tickets = []
            for i in range(3):
                tickets.append(
                    service.check_in(
                        sess,
                        license_plate=f"LOOP-{cycle}-{i}",
                        vehicle_type=VehicleType.CAR,
                        lot_id=lot_id,
                    )
                )
            # Lot is now full.
            try:
                service.check_in(
                    sess,
                    license_plate=f"LOOP-{cycle}-OVER",
                    vehicle_type=VehicleType.CAR,
                    lot_id=lot_id,
                )
                raise AssertionError("expected NoSpotAvailable")
            except NoSpotAvailable:
                pass

            for t in tickets:
                service.check_out(sess, ticket_id=t.id)

            # All spots should be free again.
            spots = (
                sess.execute(
                    select(ParkingSpot)
                    .join(Floor, ParkingSpot.floor_id == Floor.id)
                    .where(Floor.lot_id == lot_id)
                )
                .scalars()
                .all()
            )
            assert all(s.status == SpotStatus.AVAILABLE for s in spots)
    finally:
        sess.close()
