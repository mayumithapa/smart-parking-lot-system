"""Domain exceptions, mapped to HTTP responses by the API layer."""

from __future__ import annotations


class ParkingError(Exception):
    """Base class for all domain errors."""

    status_code: int = 400


class NoSpotAvailable(ParkingError):
    status_code = 409


class VehicleAlreadyParked(ParkingError):
    status_code = 409


class TicketNotFound(ParkingError):
    status_code = 404


class TicketAlreadyClosed(ParkingError):
    status_code = 409


class InvalidConfiguration(ParkingError):
    status_code = 400
