"""ParkingSpot ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import (
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import SpotStatus, SpotType

if TYPE_CHECKING:
    from app.models.floor import Floor


class ParkingSpot(Base):
    """A single parking space on a floor.

    The ``status`` column is the source of truth for availability and is
    transitioned via an atomic conditional UPDATE during allocation, so the
    table doubles as the lock target — there is no separate "reservation"
    record needed.
    """

    __tablename__ = "parking_spot"
    __table_args__ = (
        UniqueConstraint("floor_id", "code", name="uq_spot_floor_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    floor_id: Mapped[int] = mapped_column(
        ForeignKey("floor.id", ondelete="CASCADE"), index=True, nullable=False
    )
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    spot_type: Mapped[SpotType] = mapped_column(
        SqlEnum(SpotType, native_enum=False, length=20),
        index=True,
        nullable=False,
    )
    status: Mapped[SpotStatus] = mapped_column(
        SqlEnum(SpotStatus, native_enum=False, length=20),
        index=True,
        nullable=False,
        default=SpotStatus.AVAILABLE,
    )
    # Optimistic-lock counter (kept in addition to conditional UPDATE so that
    # downstream consumers can detect changes via change-data-capture).
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    floor: Mapped["Floor"] = relationship(back_populates="spots")
