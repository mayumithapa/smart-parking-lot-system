/**
 * Database engine + initializer.
 *
 * Uses better-sqlite3 (synchronous, in-process) for zero-config local dev
 * and tests. WAL mode is enabled so reads don't block writes — this is
 * what lets the worker_threads concurrency test exercise real DB-level
 * contention.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { getSettings } from "../config.js";
import * as schema from "./schema.js";

export type DB = BetterSQLite3Database<typeof schema>;

function resolveDbPath(databaseUrl: string): string {
  // Accept "file:./parking.db", "sqlite:./parking.db", or a raw path.
  if (databaseUrl.startsWith("file:")) return databaseUrl.slice("file:".length);
  if (databaseUrl.startsWith("sqlite:")) return databaseUrl.slice("sqlite:".length);
  if (databaseUrl.startsWith("sqlite:///")) return databaseUrl.slice("sqlite:///".length);
  return databaseUrl;
}

export function createDb(databaseUrl?: string): {
  db: DB;
  sqlite: Database.Database;
} {
  const url = databaseUrl ?? getSettings().databaseUrl;
  const path = resolveDbPath(url);

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 30000");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/**
 * Bootstrap the schema — for demos and tests. In production you'd ship
 * Drizzle migrations.
 */
export function initSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS parking_lot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS floor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL REFERENCES parking_lot(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      name TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_lot_number ON floor(lot_id, number);
    CREATE INDEX IF NOT EXISTS ix_floor_lot ON floor(lot_id);

    CREATE TABLE IF NOT EXISTS parking_spot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id INTEGER NOT NULL REFERENCES floor(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      spot_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_spot_floor_code ON parking_spot(floor_id, code);
    CREATE INDEX IF NOT EXISTS ix_spot_type ON parking_spot(spot_type);
    CREATE INDEX IF NOT EXISTS ix_spot_status ON parking_spot(status);

    CREATE TABLE IF NOT EXISTS vehicle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_plate TEXT NOT NULL UNIQUE,
      vehicle_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS ix_vehicle_plate ON vehicle(license_plate);

    CREATE TABLE IF NOT EXISTS parking_ticket (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicle(id),
      spot_id INTEGER NOT NULL REFERENCES parking_spot(id),
      entry_time TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      exit_time TEXT,
      amount REAL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE INDEX IF NOT EXISTS ix_ticket_vehicle_status ON parking_ticket(vehicle_id, status);
    CREATE INDEX IF NOT EXISTS ix_ticket_spot_status ON parking_ticket(spot_id, status);
  `);
}
