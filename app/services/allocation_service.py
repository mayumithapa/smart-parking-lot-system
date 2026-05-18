"""Parking spot allocation.

Concurrency model
-----------------
Allocation is the only contended write in the system: many vehicles can
arrive at the same instant and race for the same spot. Two correctness
properties matter:

1. **Mutual exclusion.** No two vehicles ever share a spot.
2. **Liveness.** If *any* compatible spot is free, allocation must succeed.

We achieve (1) with an *atomic conditional UPDATE*:

    UPDATE parking_spot
       SET status = 'OCCUPIED', version = version + 1
     WHERE id = :id AND status = 'AVAILABLE'

The database guarantees this is atomic. If the affected-row count is 0,
some other transaction got there first; we simply pick another candidate.
This pattern works on both SQLite and Postgres without ``SELECT ... FOR
UPDATE`` and degrades gracefully under contention.

Property (2) follows because the candidate scan re-reads from the DB on
each retry, so transient losers eventually observe newly-freed spots.
"""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.exceptions import NoSpotAvailable
from app.models import Floor, ParkingSpot
from app.models.enums import (
    SpotStatus,
    SpotType,
    VehicleType,
    compatible_spot_types,
)


class AllocationService:
    """Find and atomically claim a parking spot for a vehicle."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    def _candidate_spots(
        self,
        db: Session,
        *,
        lot_id: int,
        spot_type: SpotType,
        limit: int,
    ) -> list[ParkingSpot]:
        """Return up to ``limit`` AVAILABLE spots of ``spot_type`` in the lot,
        ordered by floor then spot id (closest-floor-first heuristic).
        """
        stmt = (
            select(ParkingSpot)
            .join(Floor, ParkingSpot.floor_id == Floor.id)
            .where(
                Floor.lot_id == lot_id,
                ParkingSpot.spot_type == spot_type,
                ParkingSpot.status == SpotStatus.AVAILABLE,
            )
            .order_by(Floor.number.asc(), ParkingSpot.id.asc())
            .limit(limit)
        )
        return list(db.execute(stmt).scalars().all())

    def _try_claim(self, db: Session, spot_id: int) -> bool:
        """Atomically transition AVAILABLE -> OCCUPIED. Returns True on win."""
        stmt = (
            update(ParkingSpot)
            .where(
                ParkingSpot.id == spot_id,
                ParkingSpot.status == SpotStatus.AVAILABLE,
            )
            .values(
                status=SpotStatus.OCCUPIED,
                version=ParkingSpot.version + 1,
            )
        )
        result = db.execute(stmt)
        return (result.rowcount or 0) == 1

    def allocate(
        self,
        db: Session,
        *,
        lot_id: int,
        vehicle_type: VehicleType,
    ) -> ParkingSpot:
        """Claim the smallest-fitting available spot for the given vehicle.

        Walks compatible spot types from smallest to largest. For each size,
        scans a small batch of candidates and tries to atomically claim
        them. Falls back to larger sizes only after smaller sizes are
        exhausted.

        Raises :class:`NoSpotAvailable` if every compatible spot is taken.
        """
        # Candidate batch size — large enough to absorb most contention,
        # small enough not to lock excess rows.
        batch = max(8, self._settings.allocation_max_retries * 2)

        for spot_type in compatible_spot_types(vehicle_type):
            for _ in range(self._settings.allocation_max_retries):
                candidates = self._candidate_spots(
                    db, lot_id=lot_id, spot_type=spot_type, limit=batch
                )
                if not candidates:
                    break  # try the next-larger size

                claimed_id: int | None = None
                for candidate in candidates:
                    if self._try_claim(db, candidate.id):
                        claimed_id = candidate.id
                        break

                if claimed_id is not None:
                    db.commit()
                    spot = db.get(ParkingSpot, claimed_id)
                    assert spot is not None  # we just claimed it
                    return spot

                # Lost every race in this batch — refresh and try again.
                db.rollback()

        raise NoSpotAvailable(
            f"No available spot for vehicle type {vehicle_type.value} in lot {lot_id}"
        )

    def release(self, db: Session, *, spot_id: int) -> None:
        """Mark a spot AVAILABLE again. Idempotent and safe to call twice."""
        stmt = (
            update(ParkingSpot)
            .where(
                ParkingSpot.id == spot_id,
                ParkingSpot.status == SpotStatus.OCCUPIED,
            )
            .values(
                status=SpotStatus.AVAILABLE,
                version=ParkingSpot.version + 1,
            )
        )
        db.execute(stmt)
        db.commit()
