"""Fee calculation tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.config import Settings
from app.models.enums import VehicleType
from app.services.fee_service import FeeCalculator


def _at(hours: float = 0, minutes: float = 0) -> datetime:
    base = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    return base + timedelta(hours=hours, minutes=minutes)


def test_minimum_charge_for_short_stay():
    fees = FeeCalculator()
    quote = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=_at(),
        exit_time=_at(minutes=2),
    )
    assert quote.duration_minutes == 2
    # Bumped to 1h via minimum + ceil.
    assert quote.chargeable_hours == 1
    assert quote.amount == 2.0


def test_partial_hour_rounds_up():
    fees = FeeCalculator()
    quote = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=_at(),
        exit_time=_at(hours=1, minutes=5),
    )
    assert quote.chargeable_hours == 2
    assert quote.amount == 4.0


def test_motorcycle_rate_is_cheaper():
    fees = FeeCalculator()
    car = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=_at(),
        exit_time=_at(hours=3),
    )
    moto = fees.quote(
        vehicle_type=VehicleType.MOTORCYCLE,
        entry_time=_at(),
        exit_time=_at(hours=3),
    )
    assert moto.amount < car.amount


def test_bus_rate_is_more_expensive():
    fees = FeeCalculator()
    car = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=_at(),
        exit_time=_at(hours=2),
    )
    bus = fees.quote(
        vehicle_type=VehicleType.BUS,
        entry_time=_at(),
        exit_time=_at(hours=2),
    )
    assert bus.amount > car.amount


def test_daily_cap_applies_for_long_stays():
    fees = FeeCalculator()
    quote = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=_at(),
        exit_time=_at(hours=72),  # 3 days
    )
    # capped at 24h * $2/hr = $48
    assert quote.chargeable_hours == 24
    assert quote.amount == 48.0


def test_negative_duration_rejected():
    fees = FeeCalculator()
    with pytest.raises(ValueError):
        fees.quote(
            vehicle_type=VehicleType.CAR,
            entry_time=_at(hours=2),
            exit_time=_at(hours=1),
        )


def test_naive_datetime_treated_as_utc():
    fees = FeeCalculator()
    quote = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=datetime(2026, 1, 1, 12, 0, 0),
        exit_time=datetime(2026, 1, 1, 13, 0, 0),
    )
    assert quote.chargeable_hours == 1
    assert quote.amount == 2.0


def test_custom_settings_change_rates():
    fees = FeeCalculator(
        Settings(fee_car_per_hour=10.0, fee_minimum_minutes=15, fee_daily_cap_hours=24)
    )
    quote = fees.quote(
        vehicle_type=VehicleType.CAR,
        entry_time=_at(),
        exit_time=_at(hours=1),
    )
    assert quote.amount == 10.0
