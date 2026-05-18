"""Vehicle ORM model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum as SqlEnum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import VehicleType


class Vehicle(Base):
    __tablename__ = "vehicle"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    license_plate: Mapped[str] = mapped_column(
        String(20), unique=True, index=True, nullable=False
    )
    vehicle_type: Mapped[VehicleType] = mapped_column(
        SqlEnum(VehicleType, native_enum=False, length=20),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
