"""Application configuration."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables.

    Defaults are tuned for local development (SQLite). Set ``DATABASE_URL``
    to a Postgres URL in production to take advantage of row-level locking.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Smart Parking Lot"
    database_url: str = "sqlite:///./parking.db"

    # Fee policy (currency-agnostic; treat as "units")
    fee_motorcycle_per_hour: float = 1.0
    fee_car_per_hour: float = 2.0
    fee_bus_per_hour: float = 5.0

    # Minimum chargeable duration (in minutes) — guards against zero-time exits.
    fee_minimum_minutes: int = 15

    # If a stay exceeds this many hours, cap at the daily max (24 * hourly).
    fee_daily_cap_hours: int = 24

    # Concurrency: how many times to retry contended spot allocations.
    allocation_max_retries: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
