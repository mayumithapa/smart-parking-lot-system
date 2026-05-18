"""Pytest fixtures: in-memory DB and pre-built parking lots."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app import database as database_module
from app.database import Base, get_db
from app.main import create_app
from app.models import Floor, ParkingLot, ParkingSpot
from app.models.enums import SpotType


@event.listens_for(Engine, "connect")
def _enable_sqlite_fk(dbapi_connection, _connection_record):  # noqa: ANN001
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    except Exception:
        pass


@pytest.fixture
def engine(tmp_path):
    """File-backed SQLite so each thread gets its own connection.

    SQLite serializes writes at the file level, which is exactly what the
    concurrency tests want to exercise (the application's atomic
    conditional UPDATE under real contention). WAL mode is enabled so
    readers don't block writers.
    """
    db_path = tmp_path / "test.db"
    eng = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
        future=True,
    )

    # Switch on WAL once via a fresh connection.
    with eng.connect() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        conn.exec_driver_sql("PRAGMA synchronous=NORMAL")
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        conn.commit()

    Base.metadata.create_all(eng)
    database_module.engine = eng
    database_module.SessionLocal = sessionmaker(
        bind=eng, autoflush=False, autocommit=False, expire_on_commit=False, future=True
    )
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture
def session_factory(engine) -> sessionmaker:
    return sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True
    )


@pytest.fixture
def db(session_factory) -> Iterator[Session]:
    sess = session_factory()
    try:
        yield sess
    finally:
        sess.close()


@pytest.fixture
def seeded_lot(db: Session) -> ParkingLot:
    """A small lot: 2 floors, with motorcycle/compact/large spots."""
    lot = ParkingLot(name="Test Lot", address="123 Test")
    db.add(lot)
    db.flush()

    layout = {
        # floor_number: [(code, type), ...]
        1: [
            ("M-1", SpotType.MOTORCYCLE),
            ("M-2", SpotType.MOTORCYCLE),
            ("C-1", SpotType.COMPACT),
            ("C-2", SpotType.COMPACT),
            ("L-1", SpotType.LARGE),
        ],
        2: [
            ("M-3", SpotType.MOTORCYCLE),
            ("C-3", SpotType.COMPACT),
            ("C-4", SpotType.COMPACT),
            ("L-2", SpotType.LARGE),
            ("L-3", SpotType.LARGE),
        ],
    }
    for number, spots in layout.items():
        floor = Floor(lot_id=lot.id, number=number)
        db.add(floor)
        db.flush()
        for code, st in spots:
            db.add(ParkingSpot(floor_id=floor.id, code=code, spot_type=st))
    db.commit()
    db.refresh(lot)
    return lot


@pytest.fixture
def client(engine, session_factory) -> Iterator[TestClient]:
    """FastAPI TestClient bound to the in-memory test DB."""
    app = create_app()

    def _override_get_db():
        sess = session_factory()
        try:
            yield sess
        finally:
            sess.close()

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
