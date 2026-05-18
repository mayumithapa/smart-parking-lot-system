# Entity-Relationship Diagram

```mermaid
erDiagram
    PARKING_LOT ||--o{ FLOOR : has
    FLOOR ||--o{ PARKING_SPOT : has
    VEHICLE ||--o{ PARKING_TICKET : "issues"
    PARKING_SPOT ||--o{ PARKING_TICKET : "occupied by"

    PARKING_LOT {
        int     id PK
        string  name      "UNIQUE"
        string  address
        datetime created_at
    }

    FLOOR {
        int     id PK
        int     lot_id FK
        int     number    "UNIQUE per lot"
        string  name
    }

    PARKING_SPOT {
        int     id PK
        int     floor_id FK
        string  code      "UNIQUE per floor"
        enum    spot_type "MOTORCYCLE | COMPACT | LARGE"
        enum    status    "AVAILABLE | OCCUPIED | DISABLED"
        int     version
    }

    VEHICLE {
        int     id PK
        string  license_plate "UNIQUE, uppercase"
        enum    vehicle_type  "MOTORCYCLE | CAR | BUS"
        datetime created_at
    }

    PARKING_TICKET {
        int     id PK
        int     vehicle_id FK
        int     spot_id FK
        datetime entry_time
        datetime exit_time
        float    amount
        enum     status   "ACTIVE | COMPLETED | LOST"
    }
```

## Cardinality notes

- **Lot ↔ Floor**: one-to-many; a floor belongs to exactly one lot.
- **Floor ↔ Spot**: one-to-many; a spot belongs to exactly one floor.
- **Vehicle ↔ Ticket**: one-to-many; a vehicle is reused across visits.
  At most one ticket per vehicle is `ACTIVE` at a time, enforced by the
  application's `_active_ticket_for_vehicle` check before each
  check-in.
- **Spot ↔ Ticket**: one-to-many over time; at most one ticket per spot
  is `ACTIVE` at a time, enforced by the spot's `status` flag.

## Indexes

| Table              | Index                                | Purpose                                |
| ------------------ | ------------------------------------ | -------------------------------------- |
| `parking_spot`     | `spot_type`, `status`                | Allocation candidate scan              |
| `parking_spot`     | `UNIQUE (floor_id, code)`            | Spot code uniqueness                   |
| `floor`            | `UNIQUE (lot_id, number)`            | Floor numbering                        |
| `vehicle`          | `UNIQUE (license_plate)`             | Lookups by plate                       |
| `parking_ticket`   | `(vehicle_id, status)`               | "active ticket for vehicle?" — hot     |
| `parking_ticket`   | `(spot_id, status)`                  | "active ticket on spot?" — janitor jobs|
