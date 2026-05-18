# Smart Parking Lot — Node.js + TypeScript

A 1:1 port of the Python implementation (`../`) into modern Node + TS.
Same data model, same allocation algorithm, same fee logic, same
concurrency guarantees — different stack.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 20+ | Current LTS |
| HTTP | **Fastify 5** | Faster than Express, schema-driven, TS-first |
| ORM | **Drizzle ORM** | SQL-first, exposes `result.changes` cleanly — required for our atomic-UPDATE concurrency model |
| DB driver | **better-sqlite3** | Synchronous, in-process, very fast |
| Validation | **Zod** | Runtime + compile-time schemas, integrates with Fastify |
| Tests | **Vitest** | Modern, fast, native TS |
| Concurrency test | `worker_threads` + `SharedArrayBuffer` + `Atomics` | Real threaded barrier — same rigor as Python's `threading.Barrier` |

## Quick start

```bash
cd node-ts
npm install
npm test            # 22 tests, including the threaded race
npm run dev         # http://127.0.0.1:8000
```

Open <http://127.0.0.1:8000/docs> for Swagger UI.

## Project layout

```
node-ts/
├── src/
│   ├── main.ts                          # entry point
│   ├── app.ts                           # Fastify app factory + Swagger
│   ├── app-context.ts                   # DI container
│   ├── config.ts                        # env-var settings (Zod)
│   ├── exceptions.ts                    # domain errors -> HTTP codes
│   ├── schemas.ts                       # Zod request/response schemas
│   ├── types/enums.ts                   # VehicleType, SpotType, ...
│   ├── db/
│   │   ├── index.ts                     # drizzle + better-sqlite3
│   │   └── schema.ts                    # Drizzle table definitions
│   ├── services/
│   │   ├── fee-service.ts               # FeeCalculator (pure)
│   │   ├── allocation-service.ts        # atomic conditional UPDATE
│   │   └── parking-service.ts           # check-in/check-out orchestrator
│   └── routes/
│       ├── admin.ts                     # POST /admin/lots
│       ├── parking.ts                   # POST check-in / check-out
│       └── spots.ts                     # GET availability
└── tests/
    ├── helpers/                         # DB setup + worker shim
    ├── fee-calculation.test.ts
    ├── allocation.test.ts
    ├── api.test.ts
    └── concurrency.test.ts              # 50 threads, 10 spots, no double-allocation
```

## API endpoints

All paths match the Python implementation byte-for-byte, so any
client written against one works against the other.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/admin/lots` | Create lot + floors + spots |
| `POST` | `/api/v1/parking/check-in` | Allocate spot, open ticket |
| `POST` | `/api/v1/parking/check-out` | Close ticket, compute fee, free spot |
| `GET`  | `/api/v1/lots/{lot_id}/availability` | Real-time availability |
| `GET`  | `/health` | Liveness probe |
| `GET`  | `/docs` | Swagger UI |

## Concurrency notes

- Allocation uses the same atomic conditional UPDATE pattern as the
  Python version:

  ```sql
  UPDATE parking_spot
     SET status = 'OCCUPIED', version = version + 1
   WHERE id = ? AND status = 'AVAILABLE'
  ```

  Drizzle exposes `result.changes` from better-sqlite3, so we know
  immediately if we won or lost the race. Losers retry with the next
  candidate without holding any locks.

- The concurrency test launches **50 worker threads**, each with its
  own better-sqlite3 connection, and uses a `SharedArrayBuffer` +
  `Atomics.wait`/`Atomics.notify` barrier to release them
  simultaneously. Asserts:
  - exactly 10 successes (= capacity),
  - 40 `NoSpotAvailable` failures,
  - all claimed spot ids unique,
  - no unexpected exceptions.

## Configuration

Environment variables (all optional, fall back to defaults):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `DATABASE_URL` | `file:./parking.db` | `file:` or raw path |
| `FEE_MOTORCYCLE_PER_HOUR` | `1.0` | |
| `FEE_CAR_PER_HOUR` | `2.0` | |
| `FEE_BUS_PER_HOUR` | `5.0` | |
| `FEE_MINIMUM_MINUTES` | `15` | Minimum chargeable duration |
| `FEE_DAILY_CAP_HOURS` | `24` | Caps super-long stays |
| `ALLOCATION_MAX_RETRIES` | `5` | Retries for contended spot UPDATEs |
