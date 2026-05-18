"""End-to-end API tests via FastAPI's TestClient."""

from __future__ import annotations


def _create_lot(client) -> int:
    payload = {
        "name": "API Lot",
        "address": "1 API Way",
        "floors": [
            {
                "number": 1,
                "name": "Ground",
                "spots": [
                    {"code": "M-1", "spot_type": "MOTORCYCLE"},
                    {"code": "C-1", "spot_type": "COMPACT"},
                    {"code": "C-2", "spot_type": "COMPACT"},
                    {"code": "L-1", "spot_type": "LARGE"},
                ],
            }
        ],
    }
    r = client.post("/api/v1/admin/lots", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_health_endpoint(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_full_flow(client):
    lot_id = _create_lot(client)

    r = client.get(f"/api/v1/lots/{lot_id}/availability")
    assert r.status_code == 200
    avail = {row["spot_type"]: row for row in r.json()["rows"]}
    assert avail["COMPACT"]["available"] == 2

    r = client.post(
        "/api/v1/parking/check-in",
        json={
            "license_plate": "API-1",
            "vehicle_type": "CAR",
            "lot_id": lot_id,
        },
    )
    assert r.status_code == 201, r.text
    ticket_id = r.json()["ticket_id"]

    r = client.get(f"/api/v1/lots/{lot_id}/availability")
    avail = {row["spot_type"]: row for row in r.json()["rows"]}
    assert avail["COMPACT"]["available"] == 1

    # Check-out a few hours later.
    r = client.post(
        "/api/v1/parking/check-out",
        json={
            "ticket_id": ticket_id,
            "exit_time": "2030-01-01T03:30:00+00:00",
        },
    )
    # entry_time was server-set to "now"; with our daily cap a sane fee returns.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] > 0
    assert body["spot_id"]

    r = client.get(f"/api/v1/lots/{lot_id}/availability")
    avail = {row["spot_type"]: row for row in r.json()["rows"]}
    assert avail["COMPACT"]["available"] == 2


def test_double_check_in_returns_conflict(client):
    lot_id = _create_lot(client)
    r = client.post(
        "/api/v1/parking/check-in",
        json={"license_plate": "DUP-1", "vehicle_type": "CAR", "lot_id": lot_id},
    )
    assert r.status_code == 201
    r = client.post(
        "/api/v1/parking/check-in",
        json={"license_plate": "DUP-1", "vehicle_type": "CAR", "lot_id": lot_id},
    )
    assert r.status_code == 409


def test_full_lot_returns_409(client):
    lot_id = _create_lot(client)
    # Lot has 1 motorcycle spot. Take it.
    r = client.post(
        "/api/v1/parking/check-in",
        json={"license_plate": "M-1", "vehicle_type": "MOTORCYCLE", "lot_id": lot_id},
    )
    assert r.status_code == 201
    # Second motorcycle should fall back to compact spots; take all compact.
    for plate in ("M-2", "M-3"):
        r = client.post(
            "/api/v1/parking/check-in",
            json={"license_plate": plate, "vehicle_type": "MOTORCYCLE", "lot_id": lot_id},
        )
        assert r.status_code == 201
    # Take the LARGE spot too.
    r = client.post(
        "/api/v1/parking/check-in",
        json={"license_plate": "M-4", "vehicle_type": "MOTORCYCLE", "lot_id": lot_id},
    )
    assert r.status_code == 201
    # Now another motorcycle should fail.
    r = client.post(
        "/api/v1/parking/check-in",
        json={"license_plate": "M-5", "vehicle_type": "MOTORCYCLE", "lot_id": lot_id},
    )
    assert r.status_code == 409
