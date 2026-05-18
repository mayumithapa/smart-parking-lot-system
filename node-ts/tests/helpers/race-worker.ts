/**
 * Worker thread used by the concurrency test. Each worker opens its
 * own better-sqlite3 connection on the shared DB file and attempts to
 * check in. A SharedArrayBuffer-backed Atomics barrier releases every
 * worker in the same instant, maximising the chance of a real race.
 */

import { parentPort, workerData } from "node:worker_threads";

import { createDb } from "../../src/db/index.js";
import { ParkingService } from "../../src/services/parking-service.js";
import { NoSpotAvailable } from "../../src/exceptions.js";
import type { VehicleType } from "../../src/types/enums.js";

interface WorkerInput {
  dbPath: string;
  lotId: number;
  plate: string;
  vehicleType: VehicleType;
  barrierBuf: SharedArrayBuffer;
}

interface WorkerResult {
  outcome: "OK" | "FULL" | "ERR";
  plate: string;
  spotId?: number;
  error?: string;
}

const input = workerData as WorkerInput;
const barrier = new Int32Array(input.barrierBuf);

// Block until the barrier is released (index 0 flips from 0 -> 1).
Atomics.wait(barrier, 0, 0);

const { db, sqlite } = createDb(`file:${input.dbPath}`);
const svc = new ParkingService();

let result: WorkerResult;
try {
  const ticket = svc.checkIn(db, {
    licensePlate: input.plate,
    vehicleType: input.vehicleType,
    lotId: input.lotId,
  });
  result = { outcome: "OK", plate: input.plate, spotId: ticket.spotId };
} catch (err) {
  if (err instanceof NoSpotAvailable) {
    result = { outcome: "FULL", plate: input.plate };
  } else {
    result = {
      outcome: "ERR",
      plate: input.plate,
      error: err instanceof Error ? err.message : String(err),
    };
  }
} finally {
  try {
    sqlite.close();
  } catch {
    /* noop */
  }
}

parentPort!.postMessage(result);
