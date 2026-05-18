"""Floor ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.parking_lot import ParkingLot
    from app.models.parking_spot import ParkingSpot


class Floor(Base):
    __tablename__ = "floor"
    __table_args__ = (UniqueConstraint("lot_id", "number", name="uq_floor_lot_number"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(
        ForeignKey("parking_lot.id", ondelete="CASCADE"), index=True, nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(String(60))

    lot: Mapped["ParkingLot"] = relationship(back_populates="floors")
    spots: Mapped[list["ParkingSpot"]] = relationship(
        back_populates="floor",
        cascade="all, delete-orphan",
    )
