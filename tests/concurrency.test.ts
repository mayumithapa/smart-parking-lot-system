/**
 * Concurrency tests for spot allocation.
 *
 * 50 worker threads — each with its own better-sqlite3 connection on
 * the shared DB file — race for 10 compact spots. A
 * SharedArrayBuffer-backed Atomics barrier releases them all at the
 * same instant.
 *
 * We assert:
 *   - exactly min(threads, capacity) check-ins succeed
 *   - every claimed spot id is unique (no double-allocation)
 *   - all remaining workers report NoSpotAvailable, never an error
 */

import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Worker } from "node:worker_threads";
import { eq } from "drizzle-orm";

import { createDb } from "../src/db/index.js";
import {
  floor,
  parkingLot,
  parkingSpot,
  parkingTicket,
} from "../src/db/schema.js";
import { ParkingService } from "../src/services/parking-service.js";
import { NoSpotAvailable } from "../src/exceptions.js";
import {
  SpotStatus,
  SpotType,
  TicketStatus,
  VehicleType,
} from "../src/types/enums.js";
import { freshDb } from "./helpers/db.js";

const RACE_WORKER_PATH = fileURLToPath(
  new URL("./helpers/race-worker-shim.cjs", import.meta.url),
);

interface WorkerResult {
  outcome: "OK" | "FULL" | "ERR";
  plate: string;
  spotId?: number;
  error?: string;
}

function buildLotWith(
  db: ReturnType<typeof freshDb>["db"],
  capacity: number,
): number {
  const lot = db
    .insert(parkingLot)
    .values({ name: `Race Lot ${capacity}` })
    .returning({ id: parkingLot.id })
    .get();
  const fl = db
    .insert(floor)
    .values({ lotId: lot!.id, number: 1 })
    .returning({ id: floor.id })
    .get();
  for (let i = 0; i < capacity; i++) {
    db.insert(parkingSpot)
      .values({
        floorId: fl!.id,
        code: `C-${String(i).padStart(3, "0")}`,
        spotType: SpotType.COMPACT,
      })
      .run();
  }
  return lot!.id;
}

describe("Concurrency", () => {
  let env: ReturnType<typeof freshDb>;

  beforeEach(() => {
    env = freshDb();
  });

  afterEach(() => {
    env.cleanup();
  });

  test("50 threads racing for 10 spots: no double-allocation", async () => {
    const nThreads = 50;
    const capacity = 10;
    const lotId = buildLotWith(env.db, capacity);

    // Close the test's DB handle so workers don't contend with us. We'll
    // reopen it for assertions.
    env.sqlite.close();

    const barrierBuf = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const barrier = new Int32Array(barrierBuf);

    const workers: Worker[] = [];
    const results: Promise<WorkerResult>[] = [];

    for (let i = 0; i < nThreads; i++) {
      const w = new Worker(RACE_WORKER_PATH, {
        workerData: {
          dbPath: env.path,
          lotId,
          plate: `RACE-${String(i).padStart(3, "0")}`,
          vehicleType: VehicleType.CAR,
          barrierBuf,
        },
      });
      workers.push(w);
      results.push(
        new Promise<WorkerResult>((resolve, reject) => {
          w.once("message", (m: WorkerResult) => resolve(m));
          w.once("error", reject);
          w.once("exit", (code) => {
            if (code !== 0 && code !== null) {
              reject(new Error(`worker exited with code ${code}`));
            }
          });
        }),
      );
    }

    // Give workers a moment to subscribe to the barrier.
    await new Promise((r) => setTimeout(r, 200));

    // Release every worker simultaneously.
    Atomics.store(barrier, 0, 1);
    Atomics.notify(barrier, 0, nThreads);

    const settled = await Promise.all(results);
    await Promise.all(workers.map((w) => w.terminate()));

    const successes = settled.filter((r) => r.outcome === "OK");
    const fulls = settled.filter((r) => r.outcome === "FULL");
    const errors = settled.filter((r) => r.outcome === "ERR");

    expect(errors).toEqual([]);
    expect(successes.length).toBe(capacity);
    expect(fulls.length).toBe(nThreads - capacity);

    const claimedSpotIds = successes.map((r) => r.spotId);
    expect(new Set(claimedSpotIds).size).toBe(capacity);

    // Reopen the DB for state assertions.
    const { db: db2, sqlite: s2 } = createDb(`file:${env.path}`);
    try {
      const spots = db2
        .select()
        .from(parkingSpot)
        .innerJoin(floor, eq(parkingSpot.floorId, floor.id))
        .where(eq(floor.lotId, lotId))
        .all();
      expect(spots.length).toBe(capacity);
      expect(
        spots.every((row) => row.parking_spot.status === SpotStatus.OCCUPIED),
      ).toBe(true);

      const active = db2
        .select()
        .from(parkingTicket)
        .where(eq(parkingTicket.status, TicketStatus.ACTIVE))
        .all();
      expect(active.length).toBe(capacity);
      const activeSpotIds = active.map((t) => t.spotId);
      expect(new Set(activeSpotIds).size).toBe(capacity);
    } finally {
      s2.close();
    }
  }, 60_000);

  test("repeated check-in/check-out cycles preserve invariants", () => {
    const lotId = buildLotWith(env.db, 3);
    const svc = new ParkingService();

    for (let cycle = 0; cycle < 20; cycle++) {
      const tickets = [];
      for (let i = 0; i < 3; i++) {
        tickets.push(
          svc.checkIn(env.db, {
            licensePlate: `LOOP-${cycle}-${i}`,
            vehicleType: VehicleType.CAR,
            lotId,
          }),
        );
      }

      // Lot is now full.
      expect(() =>
        svc.checkIn(env.db, {
          licensePlate: `LOOP-${cycle}-OVER`,
          vehicleType: VehicleType.CAR,
          lotId,
        }),
      ).toThrow(NoSpotAvailable);

      for (const t of tickets) {
        svc.checkOut(env.db, { ticketId: t.ticketId });
      }

      // Every spot is free again.
      const spots = env.db
        .select()
        .from(parkingSpot)
        .innerJoin(floor, eq(parkingSpot.floorId, floor.id))
        .where(eq(floor.lotId, lotId))
        .all();
      expect(
        spots.every((s) => s.parking_spot.status === SpotStatus.AVAILABLE),
      ).toBe(true);
    }
  });
});
