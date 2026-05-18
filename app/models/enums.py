"""Domain enums.

Vehicles and spots are sized along a single ordinal scale so allocation
can fall back from a smaller-preferred size up to a larger one.
"""

from __future__ import annotations

import enum


class VehicleType(str, enum.Enum):
    MOTORCYCLE = "MOTORCYCLE"
    CAR = "CAR"
    BUS = "BUS"


class SpotType(str, enum.Enum):
    """Spot sizes, ordered small -> large."""

    MOTORCYCLE = "MOTORCYCLE"
    COMPACT = "COMPACT"
    LARGE = "LARGE"


class SpotStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    DISABLED = "DISABLED"  # out of service


class TicketStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    LOST = "LOST"


# Strict ordering used by the allocation algorithm.
SPOT_SIZE_ORDER: dict[SpotType, int] = {
    SpotType.MOTORCYCLE: 0,
    SpotType.COMPACT: 1,
    SpotType.LARGE: 2,
}

# Smallest spot a vehicle may occupy.
VEHICLE_MIN_SPOT: dict[VehicleType, SpotType] = {
    VehicleType.MOTORCYCLE: SpotType.MOTORCYCLE,
    VehicleType.CAR: SpotType.COMPACT,
    VehicleType.BUS: SpotType.LARGE,
}


def compatible_spot_types(vehicle_type: VehicleType) -> list[SpotType]:
    """Return spot types a vehicle is allowed to use, smallest first.

    A vehicle may park in any spot at least as large as its minimum.
    Smaller spots are preferred so larger spots remain available for
    vehicles that genuinely need them.
    """
    minimum = VEHICLE_MIN_SPOT[vehicle_type]
    min_rank = SPOT_SIZE_ORDER[minimum]
    return [s for s, rank in SPOT_SIZE_ORDER.items() if rank >= min_rank]
