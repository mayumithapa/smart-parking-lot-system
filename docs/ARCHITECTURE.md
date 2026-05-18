# Architecture

This document explains the *why* behind the design. The code is the
canonical *what*.

## Design goals

The brief asks for four things; each maps to one section below:

1. A clean **data model** for spots, vehicles, and transactions.
2. An **allocation algorithm** that picks the right spot.
3. **Fee calculation** based on duration and vehicle type.
4. **Concurrency** that holds up when many vehicles arrive at once.

The implementation is split into four layers — **Models → Repositories
(via SQLAlchemy queries) → Services → API** — so each concern is
testable in isolation.

```
HTTP request
    │
    ▼
┌───────────────┐
│  FastAPI API  │  request validation, error mapping
└──────┬────────┘
       ▼
┌───────────────┐
│   Services    │  business rules, transactions
│ ParkingService│
│ AllocationSvc │
│ FeeCalculator │
└──────┬────────┘
       ▼
┌───────────────┐
│   ORM Models  │  schema, constraints, conditional UPDATEs
└──────┬────────┘
       ▼
   Database
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

`AllocationService.allocate(db, lot_id, vehicle_type)` is the entry
point. The intent is:

> Park the vehicle in the **smallest spot it fits in**, leaving larger
> spots available for vehicles that genuinely need them.

The vehicle → spot compatibility table:

| Vehicle    | Eligible spots (smallest first)         |
| ---------- | --------------------------------------- |
| Motorcycle | `MOTORCYCLE` → `COMPACT` → `LARGE`      |
| Car        | `COMPACT` → `LARGE`                     |
| Bus        | `LARGE` only                            |

This is encoded as a single ordinal scale in `models/enums.py`:

```python
SPOT_SIZE_ORDER = {MOTORCYCLE: 0, COMPACT: 1, LARGE: 2}
VEHICLE_MIN_SPOT = {MOTORCYCLE: MOTORCYCLE, CAR: COMPACT, BUS: LARGE}
```

Adding a new size (e.g. `OVERSIZED`) is a one-line change.

### Algorithm

```
for spot_type in compatible_spot_types(vehicle_type):
    for retry in 0..MAX_RETRIES:
        candidates = SELECT ... FROM parking_spot
                     WHERE lot_id = ? AND spot_type = ?
                       AND status = 'AVAILABLE'
                     ORDER BY floor.number, spot.id
                     LIMIT BATCH

        for c in candidates:
            if conditional_update(c.id) == 1 row affected:
                return c          ← we won the race

        # Lost every candidate in this batch — re-read.
raise NoSpotAvailable
```

**Why a batch of candidates?** Under heavy contention, the first
candidate is also the first candidate every other thread sees, so
they all collide on it. Pulling a small batch (8 by default) gives
each loser a different fallback to try without re-querying — a
ten-line optimization that turns N rounds of contention into ~1.

**Why iterate spot types in order?** Buses must never park in compacts;
cars must prefer compacts before falling back to large. The ordered
loop encodes that policy declaratively.

---

## 3 · Fee calculation

`FeeCalculator.quote()` is intentionally a pure function. Given
`(vehicle_type, entry_time, exit_time)` it returns a `FeeQuote`:

```
duration_minutes = ceil((exit - entry).total_seconds() / 60)
chargeable_minutes = max(duration_minutes, MIN_CHARGE_MIN)
chargeable_hours   = max(1, ceil(chargeable_minutes / 60))
chargeable_hours   = min(chargeable_hours, DAILY_CAP_HOURS)
amount = chargeable_hours * RATE[vehicle_type]
```

Why these specific rules:

- **Round duration to whole minutes upward** — never under-charge by a
  few seconds.
- **Minimum chargeable duration (15 min default)** — short stays still
  carry a base charge, which discourages drive-through abuse.
- **Round hours up** — a 1h05m stay pays for 2h. Standard parking
  industry behaviour.
- **Daily cap (24h default)** — long stays don't blow up linearly.

All four parameters live in `Settings` and can be overridden per-deploy
without changing the calculator. Unit tests pin every branch.

### Why naive datetimes are dangerous

SQLite stores `DateTime(timezone=True)` columns as naive. The fee
calculator normalizes both inputs to UTC **before** comparison, so the
mix of "DB-roundtripped naive" and "freshly created aware" datetimes
that you get in real flows doesn't crash the math.

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
  `rowcount == 0`.

This is **portable** — works the same on SQLite, Postgres, MySQL — and
**non-blocking** — losers don't sit in a lock queue, they immediately
retry with a different candidate. We don't need `SELECT ... FOR UPDATE`
or application-level locks.

### Compensation on partial failure

`ParkingService.check_in` claims the spot first, then writes the
ticket row. If the ticket insert fails (FK violation, etc.), we
compensate by releasing the spot:

```python
spot = allocator.allocate(...)          # commits the spot transition
try:
    db.add(ticket); db.commit()
except Exception:
    allocator.release(spot_id=spot.id)   # release on rollback
    raise
```

This keeps the two writes consistent without a distributed transaction.

### Crash recovery on check-out

Check-out closes the ticket *before* freeing the spot:

```
1. ticket.status = COMPLETED            (commit 1)
2. spot.status   = AVAILABLE            (commit 2)
```

If the process crashes between steps 1 and 2, we end up with a
COMPLETED ticket and an OCCUPIED spot — recoverable by a janitor job
that scans for `OCCUPIED` spots whose latest ticket is `COMPLETED`.
The reverse ordering would be unrecoverable (a freed spot with an
ACTIVE ticket would be **double-allocated** to the next vehicle).

### Verified by test

`tests/test_concurrency.py::test_no_double_allocation_under_contention`
spawns 50 threads behind a `threading.Barrier`, releases them
simultaneously, and asserts:

- exactly `min(threads, capacity)` succeeded,
- every claimed spot id is unique,
- the rest got `NoSpotAvailable`,
- no unexpected exceptions occurred.

---

## Production readiness checklist

What this codebase intentionally *doesn't* do, so a reviewer can map
the gaps:

- **Authentication / RBAC.** Add a JWT dependency on `/admin/*`.
- **Migrations.** `init_db()` is fine for demos; production wants
  Alembic.
- **Payment.** `amount` is computed but not collected. Drop in a payment
  provider on top of `check_out`.
- **Observability.** Add structured logging + OpenTelemetry traces
  around `check_in` / `check_out`.
- **Rate-limiting.** Cheap protection against scrapers hammering
  `/availability`.
- **Postgres in production.** SQLite's WAL mode handles the load
  here, but Postgres gives row-level locks, replication, and `LISTEN/
  NOTIFY` if availability needs to push instead of poll.
