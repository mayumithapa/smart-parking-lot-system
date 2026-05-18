# Architecture

This document explains the *why* behind the design. The code is the
canonical *what*.

## Design goals

The brief asks for four things; each maps to one section below:

1. A clean **data model** for spots, vehicles, and transactions.
2. An **allocation algorithm** that picks the right spot.
3. **Fee calculation** based on duration and vehicle type.
4. **Concurrency** that holds up when many vehicles arrive at once.

The implementation is split into four layers — **Schema → Services →
Routes → App** — so each concern is testable in isolation.

```
HTTP request
    │
    ▼
┌──────────────────────────┐
│  Fastify routes          │  request validation (Zod), error mapping
│  src/routes/*.ts         │
└──────┬───────────────────┘
       ▼
┌──────────────────────────┐
│  Services                │  business rules, transactions
│  ParkingService          │
│  AllocationService       │
│  FeeCalculator           │
└──────┬───────────────────┘
       ▼
┌──────────────────────────┐
│  Drizzle ORM             │  schema, conditional UPDATEs, queries
│  src/db/schema.ts        │
└──────┬───────────────────┘
       ▼
   better-sqlite3 (SQLite)
```

---

## 1 · Data model

Five tables — minimal but expressive enough to support multi-lot,
multi-floor, multi-size deployments. See [`ER_DIAGRAM.md`](ER_DIAGRAM.md)
for the visual.

### `parking_lot` and `floor`

A lot has many floors; floors are scoped to a lot
(`UNIQUE (lot_id, number)`). This lets us query availability per lot
without scanning the global spot table.

### `parking_spot`

| Column      | Notes                                              |
| ----------- | -------------------------------------------------- |
| `spot_type` | `MOTORCYCLE` / `COMPACT` / `LARGE` (small → large) |
| `status`    | `AVAILABLE` / `OCCUPIED` / `DISABLED`              |
| `version`   | Bumped on every state change                       |

`status` is the single source of truth for availability. Moving a spot
between states is the only contended write in the system, and it's done
via an **atomic conditional UPDATE** (see §4). `version` isn't required
for correctness — the conditional UPDATE alone is enough — but it's
useful for change-data-capture and gives us optimistic-locking
semantics for free.

### `vehicle`

Stable identity for a license plate, normalized to uppercase. Vehicles
are **reused across visits**; this lets the system later support
loyalty programs, blacklists, monthly passes, etc., without schema
changes.

### `parking_ticket`

The transaction record. One row per stay:

- `entry_time` is server-set on check-in.
- `exit_time` and `amount` are written on check-out.
- `status ∈ {ACTIVE, COMPLETED, LOST}` — `LOST` is reserved for the
  "I lost my ticket" flow that a future iteration can add.

A composite index on `(vehicle_id, status)` makes "does this vehicle
already have an active ticket?" an O(1) lookup, which is the hottest
query on the check-in path.

---

## 2 · Allocation algorithm

`AllocationService.allocate(db, { lotId, vehicleType })` is the entry
point. The intent is:

> Park the vehicle in the **smallest spot it fits in**, leaving larger
> spots available for vehicles that genuinely need them.

The vehicle → spot compatibility table:

| Vehicle    | Eligible spots (smallest first)         |
| ---------- | --------------------------------------- |
| Motorcycle | `MOTORCYCLE` → `COMPACT` → `LARGE`      |
| Car        | `COMPACT` → `LARGE`                     |
| Bus        | `LARGE` only                            |

This is encoded as a single ordinal scale in `src/types/enums.ts`:

```ts
const SPOT_SIZE_ORDER = { MOTORCYCLE: 0, COMPACT: 1, LARGE: 2 };
const VEHICLE_MIN_SPOT = {
  MOTORCYCLE: SpotType.MOTORCYCLE,
  CAR: SpotType.COMPACT,
  BUS: SpotType.LARGE,
};
```

Adding a new size (e.g. `OVERSIZED`) is a one-line change.

### Algorithm

```
for spotType in compatibleSpotTypes(vehicleType):
    for retry in 0..MAX_RETRIES:
        candidates = SELECT id FROM parking_spot
                     WHERE lot_id = ? AND spot_type = ?
                       AND status = 'AVAILABLE'
                     ORDER BY floor.number, parking_spot.id
                     LIMIT BATCH

        for c in candidates:
            if conditionalUpdate(c.id) had 1 row affected:
                return c.id          ← we won the race

        # Lost every candidate in this batch — re-read.
throw NoSpotAvailable
```

**Why a batch of candidates?** Under heavy contention, the first
candidate is also the first candidate every other thread sees, so they
all collide on it. Pulling a small batch (8 by default) gives each
loser a different fallback to try without re-querying — a ten-line
optimization that turns N rounds of contention into ~1.

**Why iterate spot types in order?** Buses must never park in compacts;
cars must prefer compacts before falling back to large. The ordered
loop encodes that policy declaratively.

---

## 3 · Fee calculation

`FeeCalculator.quote()` is intentionally a pure function. Given
`(vehicleType, entryTime, exitTime)` it returns a `FeeQuote`:

```
durationMinutes   = ceil((exit - entry) / 60_000)
chargeableMinutes = max(durationMinutes, MIN_CHARGE_MIN)
chargeableHours   = max(1, ceil(chargeableMinutes / 60))
chargeableHours   = min(chargeableHours, DAILY_CAP_HOURS)
amount            = chargeableHours * RATE[vehicleType]
```

Why these specific rules:

- **Round duration to whole minutes upward** — never under-charge by a
  few seconds.
- **Minimum chargeable duration (15 min default)** — short stays still
  carry a base charge, which discourages drive-through abuse.
- **Round hours up** — a 1h05m stay pays for 2h. Standard parking
  industry behaviour.
- **Daily cap (24h default)** — long stays don't blow up linearly.

All four parameters live in `Settings` (Zod-validated env vars) and can
be overridden per-deploy without changing the calculator. Unit tests
pin every branch.

### Why dates need careful handling

JavaScript `Date` is famously quirky around timezones. The fee
calculator accepts either a `string` (ISO 8601) or a `Date` object,
parses both via `Date.parse`, and works in epoch milliseconds for the
duration math. SQLite stores datetimes as ISO strings, so a value
written by Drizzle round-trips losslessly.

---

## 4 · Concurrency

The only contended write in this system is "claim a spot". The data
shape — N readers competing to flip one row from `AVAILABLE` to
`OCCUPIED` — has a textbook solution.

### The atomic claim

```sql
UPDATE parking_spot
   SET status = 'OCCUPIED',
       version = version + 1
 WHERE id = :spot_id
   AND status = 'AVAILABLE'
```

Every relational database guarantees:

- The `WHERE` clause is evaluated and the `SET` is applied as a single
  atomic step.
- Exactly one transaction's update wins; the other(s) report
  `result.changes === 0`.

This is **portable** — works the same on SQLite, Postgres, MySQL — and
**non-blocking** — losers don't sit in a lock queue, they immediately
retry with a different candidate. We don't need `SELECT ... FOR UPDATE`
or application-level locks.

Drizzle's update builder calls into better-sqlite3 which surfaces
`result.changes` directly:

```ts
const result = db
  .update(parkingSpot)
  .set({ status: SpotStatus.OCCUPIED, version: sql`${parkingSpot.version} + 1` })
  .where(and(eq(parkingSpot.id, spotId), eq(parkingSpot.status, SpotStatus.AVAILABLE)))
  .run();

return result.changes === 1; // true → we won
```

### Compensation on partial failure

`ParkingService.checkIn` claims the spot first, then writes the ticket
row. If the ticket insert fails, we compensate by releasing the spot:

```ts
const spotId = allocator.allocate(db, args);
try {
  db.insert(parkingTicket).values({ ... }).run();
} catch (err) {
  allocator.release(db, spotId);
  throw err;
}
```

This keeps the two writes consistent without a distributed transaction.

### Crash recovery on check-out

Check-out closes the ticket *before* freeing the spot:

```
1. ticket.status = COMPLETED            (write 1)
2. spot.status   = AVAILABLE            (write 2)
```

If the process crashes between steps 1 and 2, we end up with a
COMPLETED ticket and an OCCUPIED spot — recoverable by a janitor job
that scans for `OCCUPIED` spots whose latest ticket is `COMPLETED`.
The reverse ordering would be unrecoverable (a freed spot with an
ACTIVE ticket would be **double-allocated** to the next vehicle).

### Verified by test

`tests/concurrency.test.ts` spawns **50 worker threads**, each opening
its own `better-sqlite3` connection on a shared DB file. A
`SharedArrayBuffer` + `Atomics.wait` / `Atomics.notify` barrier
releases them all in the same instant.

The test asserts:

- exactly `min(threads, capacity)` succeeded,
- every claimed spot id is unique,
- the rest threw `NoSpotAvailable`,
- no unexpected exceptions occurred.

This is the strongest possible test of the concurrency model in a
single-process Node app — real OS threads, real DB-level contention,
real atomic semantics.

---

## Production readiness checklist

What this codebase intentionally *doesn't* do, so a reviewer can map
the gaps:

- **Authentication / RBAC.** Add a Fastify auth plugin on `/admin/*`.
- **Migrations.** `initSchema()` is fine for demos; production wants
  Drizzle migrations (`drizzle-kit generate`).
- **Payment.** `amount` is computed but not collected. Drop in a payment
  provider on top of `checkOut`.
- **Observability.** Add structured logging via Fastify's logger and
  OpenTelemetry traces around `checkIn` / `checkOut`.
- **Rate-limiting.** `@fastify/rate-limit` is a 5-line addition.
- **Postgres in production.** SQLite's WAL mode handles the load
  here, but Postgres gives row-level locks, replication, and
  `LISTEN / NOTIFY` if availability needs to push instead of poll.
  The atomic conditional-UPDATE pattern works identically on Postgres
  via `drizzle-orm/postgres-js`.
