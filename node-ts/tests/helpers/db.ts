/**
 * Test helpers for spinning up an isolated SQLite DB per test.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, initSchema, type DB } from "../../src/db/index.js";
import {
  floor,
  parkingLot,
  parkingSpot,
} from "../../src/db/schema.js";
import { SpotType } from "../../src/types/enums.js";

export function freshDb(): {
  db: DB;
  sqlite: ReturnType<typeof createDb>["sqlite"];
  cleanup: () => void;
  path: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "spl-test-"));
  const path = join(dir, "test.db");
  const { db, sqlite } = createDb(`file:${path}`);
  initSchema(sqlite);
  return {
    db,
    sqlite,
    path,
    cleanup: () => {
      try {
        sqlite.close();
      } catch {
        /* noop */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    },
  };
}

/** Seed a small lot: 2 floors, motorcycle/compact/large spots. */
export function seedLot(db: DB): {
  lotId: number;
} {
  const lot = db
    .insert(parkingLot)
    .values({ name: "Test Lot", address: "123 Test" })
    .returning({ id: parkingLot.id })
    .get();

  const layout: Record<number, Array<[string, SpotType]>> = {
    1: [
      ["M-1", SpotType.MOTORCYCLE],
      ["M-2", SpotType.MOTORCYCLE],
      ["C-1", SpotType.COMPACT],
      ["C-2", SpotType.COMPACT],
      ["L-1", SpotType.LARGE],
    ],
    2: [
      ["M-3", SpotType.MOTORCYCLE],
      ["C-3", SpotType.COMPACT],
      ["C-4", SpotType.COMPACT],
      ["L-2", SpotType.LARGE],
      ["L-3", SpotType.LARGE],
    ],
  };

  for (const [number, spots] of Object.entries(layout)) {
    const fl = db
      .insert(floor)
      .values({ lotId: lot!.id, number: Number(number) })
      .returning({ id: floor.id })
      .get();
    for (const [code, st] of spots) {
      db.insert(parkingSpot)
        .values({ floorId: fl!.id, code, spotType: st })
        .run();
    }
  }

  return { lotId: lot!.id };
}
