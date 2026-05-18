"""ParkingTicket ORM model — the transaction record for a single stay."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum as SqlEnum,
    Float,
    ForeignKey,
    Index,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import TicketStatus
from app.models.parking_spot import ParkingSpot
from app.models.vehicle import Vehicle


class ParkingTicket(Base):
    __tablename__ = "parking_ticket"
    __table_args__ = (
        # Fast lookup of the active ticket for a given vehicle.
        Index("ix_ticket_vehicle_status", "vehicle_id", "status"),
        Index("ix_ticket_spot_status", "spot_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicle.id", ondelete="RESTRICT"), nullable=False
    )
    spot_id: Mapped[int] = mapped_column(
        ForeignKey("parking_spot.id", ondelete="RESTRICT"), nullable=False
    )

    entry_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    amount: Mapped[float | None] = mapped_column(Float)

    status: Mapped[TicketStatus] = mapped_column(
        SqlEnum(TicketStatus, native_enum=False, length=20),
        nullable=False,
        default=TicketStatus.ACTIVE,
        index=True,
    )

    vehicle: Mapped[Vehicle] = relationship(lazy="joined")
    spot: Mapped[ParkingSpot] = relationship(lazy="joined")
