# Smart Parking Lot System

A backend system for a multi-floor smart parking lot. It assigns spots
based on vehicle size, tracks each vehicle's stay, calculates fees on
exit, and exposes real-time availability — all of it concurrency-safe.

Built with **Node.js 20**, **TypeScript**, **Fastify**, **Drizzle ORM**,
and **better-sqlite3**. Validation by **Zod**, tests by **Vitest**.

---

## How this maps to the brief

| Brief requirement | Implementation | Verified by |
|---|---|---|
| **Spot allocation by vehicle size** (motorcycle / car / bus) | `src/services/allocation-service.ts` — smallest-fit with size-based fallback | `tests/allocation.test.ts` |
| **Check-in / check-out + entry & exit times** | `src/services/parking-service.ts` writes `entry_time` on check-in, `exit_time` and `amount` on check-out, persisted on `parking_ticket` | `tests/allocation.test.ts`, `tests/api.test.ts` |
| **Fee calculation by duration & vehicle type** | `src/services/fee-service.ts` — per-vehicle hourly rates, minimum-charge, ceil-to-hour, daily cap | `tests/fee-calculation.test.ts` |
| **Real-time availability** | `src/services/parking-service.ts::availability` — single `GROUP BY` query; spot `status` flips atomically on every check-in/out so reads always reflect current state | `tests/api.test.ts` |

| Design aspect from the brief | Where it lives |
|---|---|
| **Data model** | `src/db/schema.ts` (5 tables: parking_lot, floor, parking_spot, vehicle, parking_ticket) + `docs/ER_DIAGRAM.md` |
| **Allocation algorithm** | `src/services/allocation-service.ts` + walkthrough in `docs/ARCHITECTURE.md §2` |
| **Fee calculation logic** | `src/services/fee-service.ts` (pure function, returns `FeeQuote`) + `docs/ARCHITECTURE.md §3` |
| **Concurrency handling** | Atomic conditional UPDATE — `docs/ARCHITECTURE.md §4`. Verified by a 50-thread `worker_threads` race test |

---

## Highlights

- **Vehicle-aware allocation.** Smallest-fitting spot is preferred; cars
  fall back to large spots only when compacts are full; buses never use
  smaller spots.
- **Atomic check-in.** Spot transitions use a conditional `UPDATE ...
  WHERE status = 'AVAILABLE'`, which is atomic in every relational DB.
  Two concurrent vehicles can never claim the same spot.
- **Verified concurrency.** A test launches **50 worker threads**, each
  with its own `better-sqlite3` connection, and uses a
  `SharedArrayBuffer` + `Atomics` barrier to release them
  simultaneously. Asserts exactly 10 unique winners with zero
  double-allocations.
- **Configurable fee policy.** Per-vehicle hourly rates, minimum
  chargeable duration, and a daily cap, all in `src/config.ts`.
- **Real-time availability** per spot type, computed in a single query.
- **Auto-generated Swagger UI** at `/docs` — no extra schemas to write.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design
narrative and [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md) for the data
model.

---

## Quick start

```bash
npm install
npm run dev          # http://127.0.0.1:8000  →  /docs for Swagger UI
```

### Run the tests

```bash
npm test
```

22 tests covering allocation rules, fee math, end-to-end HTTP, and a
**real 50-thread concurrency race**.

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
src/
  main.ts                          # entry point
  app.ts                           # Fastify app factory + Swagger
  app-context.ts                   # DI container
  config.ts                        # env-var settings (Zod)
  exceptions.ts                    # domain errors -> HTTP codes
  schemas.ts                       # Zod request/response schemas
  types/enums.ts                   # VehicleType, SpotType, ...
  db/
    index.ts                       # drizzle + better-sqlite3
    schema.ts                      # Drizzle table definitions
  services/
    fee-service.ts                 # FeeCalculator (pure)
    allocation-service.ts          # atomic conditional UPDATE
    parking-service.ts             # check-in/check-out orchestrator
  routes/
    admin.ts                       # POST /admin/lots
    parking.ts                     # POST check-in / check-out
    spots.ts                       # GET availability
tests/
  helpers/                         # DB setup + worker shim
  fee-calculation.test.ts
  allocation.test.ts
  api.test.ts
  concurrency.test.ts              # 50 threads, 10 spots, no double-allocation
docs/
  ARCHITECTURE.md
  ER_DIAGRAM.md
```

---

## Configuration

Environment variables (or a `.env` file in the project root):

| Variable                  | Default                  | Notes                                          |
| ------------------------- | ------------------------ | ---------------------------------------------- |
| `PORT`                    | `8000`                   | HTTP port                                      |
| `HOST`                    | `127.0.0.1`              | Bind address                                   |
| `DATABASE_URL`            | `file:./parking.db`      | `file:` URI or raw path; SQLite by default     |
| `FEE_MOTORCYCLE_PER_HOUR` | `1.0`                    |                                                |
| `FEE_CAR_PER_HOUR`        | `2.0`                    |                                                |
| `FEE_BUS_PER_HOUR`        | `5.0`                    |                                                |
| `FEE_MINIMUM_MINUTES`     | `15`                     | Minimum chargeable duration                    |
| `FEE_DAILY_CAP_HOURS`     | `24`                     | Caps super-long stays at one day's worth       |
| `ALLOCATION_MAX_RETRIES`  | `5`                      | Retries when losing the conditional-UPDATE race|

---

## License

MIT.
