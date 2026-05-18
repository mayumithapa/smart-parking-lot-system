"""Fee calculation.

The strategy is intentionally simple and easy to swap out:

  fee = max(minimum_charge, ceil(minutes / 60) * hourly_rate)

with an optional daily cap (by default, 24h). Hourly rates and the minimum
charge are configurable; rates are keyed on :class:`VehicleType` so adding a
new vehicle class is a one-line change.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import Settings, get_settings
from app.models.enums import VehicleType


@dataclass(frozen=True)
class FeeQuote:
    duration_minutes: int
    chargeable_hours: int
    rate_per_hour: float
    amount: float


class FeeCalculator:
    """Compute parking fees from entry/exit times and vehicle type."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    def _rate_for(self, vt: VehicleType) -> float:
        s = self._settings
        return {
            VehicleType.MOTORCYCLE: s.fee_motorcycle_per_hour,
            VehicleType.CAR: s.fee_car_per_hour,
            VehicleType.BUS: s.fee_bus_per_hour,
        }[vt]

    @staticmethod
    def _to_utc(dt: datetime) -> datetime:
        """Normalize naive datetimes to UTC (assume server clock is UTC)."""
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    def quote(
        self,
        *,
        vehicle_type: VehicleType,
        entry_time: datetime,
        exit_time: datetime,
    ) -> FeeQuote:
        # Normalize to UTC first so we can compare safely — SQLite ignores
        # timezones and returns naive datetimes, while in-memory values are
        # timezone-aware.
        entry = self._to_utc(entry_time)
        exit_ = self._to_utc(exit_time)

        if exit_ < entry:
            raise ValueError("exit_time must be >= entry_time")

        delta_seconds = (exit_ - entry).total_seconds()
        # Round duration up to the next whole minute so we never under-charge
        # by a few seconds.
        duration_minutes = max(0, math.ceil(delta_seconds / 60))

        # Apply minimum chargeable duration (e.g. a 2-minute stay still pays).
        chargeable_minutes = max(duration_minutes, self._settings.fee_minimum_minutes)

        # Round hours UP — a 1h05m stay is billed as 2 hours.
        chargeable_hours = max(1, math.ceil(chargeable_minutes / 60))

        # Apply daily cap.
        chargeable_hours = min(chargeable_hours, self._settings.fee_daily_cap_hours)

        rate = self._rate_for(vehicle_type)
        amount = round(chargeable_hours * rate, 2)

        return FeeQuote(
            duration_minutes=duration_minutes,
            chargeable_hours=chargeable_hours,
            rate_per_hour=rate,
            amount=amount,
        )
