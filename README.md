# Smart Parking Lot System

A backend system for a multi-floor smart parking lot. It assigns spots
based on vehicle size, tracks each vehicle's stay, calculates fees on
exit, and exposes real-time availability — all of it concurrency-safe.

This repo ships **two parallel implementations** with byte-identical APIs
and equivalent test rigor — pick whichever stack you prefer.

| Implementation | Stack | Folder | Status |
|---|---|---|---|
| **Python** (primary) | FastAPI · SQLAlchemy 2.0 · Pydantic v2 · pytest | [`./`](./) | 23/23 tests passing |
| **Node.js + TypeScript** | Fastify 5 · Drizzle ORM · Zod · Vitest · `worker_threads` | [`./node-ts/`](./node-ts/) | 22/22 tests passing |

The two implementations share the same data model, allocation
algorithm, fee logic, and concurrency strategy. The Node side uses
`worker_threads` + `SharedArrayBuffer` + `Atomics` for its 50-thread
concurrency test — equivalent rigor to Python's `threading.Barrier`.

> The rest of this README documents the **Python** implementation. See
> [`node-ts/README.md`](./node-ts/README.md) for the Node version.

---

Built with **FastAPI**, **SQLAlchemy 2.0**, and **Pydantic v2**. Runs on
SQLite out of the box; point `DATABASE_URL` at PostgreSQL for production.

---

## Highlights

- **Vehicle-aware allocation.** Smallest-fitting spot is preferred; cars
  fall back to large spots only when compacts are full; buses never use
  smaller spots.
- **Atomic check-in.** Spot transitions use a conditional `UPDATE ...
  WHERE status = 'AVAILABLE'`, which is atomic in every relational DB.
  Two concurrent vehicles can never claim the same spot.
- **Verified concurrency.** A 50-thread test races for 10 spots and
  asserts exactly 10 unique winners with zero double-allocations.
- **Configurable fee policy.** Per-vehicle hourly rates, minimum
  chargeable duration, and a daily cap, all in `app/config.py`.
- **Real-time availability** per spot type, computed in a single query.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design
narrative and [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md) for the data
model.

---

## Quick start

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt

uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000/docs> for the interactive Swagger UI.

### Run the tests

```bash
pytest -v
```

23 tests cover allocation rules, fee math, concurrent check-in races,
and the HTTP API.

---

## API at a glance

All endpoints are versioned under `/api/v1`.

### 1. Create a parking lot

```http
POST /api/v1/admin/lots
```

```json
{
  "name": "Downtown Garage",
  "address": "1 Main St",
  "floors": [
    {
      "number": 1,
      "spots": [
        {"code": "M-1", "spot_type": "MOTORCYCLE"},
        {"code": "C-1", "spot_type": "COMPACT"},
        {"code": "C-2", "spot_type": "COMPACT"},
        {"code": "L-1", "spot_type": "LARGE"}
      ]
    }
  ]
}
```

### 2. Check a vehicle in

```http
POST /api/v1/parking/check-in
```

```json
{
  "license_plate": "ABC-123",
  "vehicle_type": "CAR",
  "lot_id": 1
}
```

Returns the assigned spot and a ticket id. `409` if the lot is full or
the vehicle is already parked.

### 3. Check a vehicle out

```http
POST /api/v1/parking/check-out
```

```json
{ "ticket_id": 42 }
```

Returns the duration, the computed amount, and frees the spot.

### 4. Real-time availability

```http
GET /api/v1/lots/{lot_id}/availability
```

```json
{
  "lot_id": 1,
  "rows": [
    {"spot_type": "MOTORCYCLE", "available": 1, "total": 1},
    {"spot_type": "COMPACT",    "available": 2, "total": 2},
    {"spot_type": "LARGE",      "available": 1, "total": 1}
  ]
}
```

---

## Project layout

```
app/
  main.py              # FastAPI app factory
  config.py            # Settings (rates, retries, DB URL)
  database.py          # Engine + session + Base
  exceptions.py        # Domain errors -> HTTP codes
  models/              # SQLAlchemy ORM models + enums
  schemas/             # Pydantic I/O schemas
  services/
    fee_service.py         # Fee strategy
    allocation_service.py  # Concurrency-safe spot claim
    parking_service.py     # check-in / check-out orchestration
  api/v1/              # Routers: admin, parking, spots
tests/
  test_allocation.py     # vehicle-size matching, fallbacks
  test_fee_calculation.py# rate, rounding, caps
  test_concurrency.py    # 50-thread race, idempotency
  test_api.py            # end-to-end HTTP
docs/
  ARCHITECTURE.md
  ER_DIAGRAM.md
```

---

## Configuration

Environment variables (or a `.env` file in the project root):

| Variable                     | Default                  | Notes                                          |
| ---------------------------- | ------------------------ | ---------------------------------------------- |
| `DATABASE_URL`               | `sqlite:///./parking.db` | Use a Postgres URL in production               |
| `FEE_MOTORCYCLE_PER_HOUR`    | `1.0`                    |                                                |
| `FEE_CAR_PER_HOUR`           | `2.0`                    |                                                |
| `FEE_BUS_PER_HOUR`           | `5.0`                    |                                                |
| `FEE_MINIMUM_MINUTES`        | `15`                     | Minimum chargeable duration                    |
| `FEE_DAILY_CAP_HOURS`        | `24`                     | Caps super-long stays at one day's worth       |
| `ALLOCATION_MAX_RETRIES`     | `5`                      | Retries when losing the conditional-UPDATE race|

---

## License

MIT.
