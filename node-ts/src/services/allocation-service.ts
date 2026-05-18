/**
 * Parking spot allocation.
 *
 * Concurrency model
 * -----------------
 * Many vehicles can race for the same free spot. Two correctness
 * properties matter:
 *
 *   1. Mutual exclusion — no two vehicles ever share a spot.
 *   2. Liveness         — if any compatible spot is free, allocation
 *                          must succeed.
 *
 * We get (1) for free with an *atomic conditional UPDATE*:
 *
 *     UPDATE parking_spot
 *        SET status = 'OCCUPIED', version = version + 1
 *      WHERE id = :id AND status = 'AVAILABLE'
 *
 * The DB guarantees this is atomic. If `rowsAffected === 0`, some other
 * transaction got there first; we just pick another candidate.
 *
 * Property (2) follows because the candidate scan re-reads the DB on
 * each retry, so transient losers eventually observe newly-freed spots.
 *
 * The same pattern works on SQLite, Postgres, and MySQL — no
 * `SELECT ... FOR UPDATE` required.
 */

import { and, eq, sql } from "drizzle-orm";

import { getSettings, type Settings } from "../config.js";
import type { DB } from "../db/index.js";
import { floor, parkingSpot } from "../db/schema.js";
import { NoSpotAvailable } from "../exceptions.js";
import {
  compatibleSpotTypes,
  SpotStatus,
  type SpotType,
  type VehicleType,
} from "../types/enums.js";

export class AllocationService {
  private readonly settings: Settings;

  constructor(settings?: Settings) {
    this.settings = settings ?? getSettings();
  }

  private candidateSpots(
    db: DB,
    args: { lotId: number; spotType: SpotType; limit: number },
  ): { id: number }[] {
    return db
      .select({ id: parkingSpot.id })
      .from(parkingSpot)
      .innerJoin(floor, eq(parkingSpot.floorId, floor.id))
      .where(
        and(
          eq(floor.lotId, args.lotId),
          eq(parkingSpot.spotType, args.spotType),
          eq(parkingSpot.status, SpotStatus.AVAILABLE),
        ),
      )
      .orderBy(floor.number, parkingSpot.id)
      .limit(args.limit)
      .all();
  }

  /** Atomically transition AVAILABLE -> OCCUPIED. Returns true on win. */
  private tryClaim(db: DB, spotId: number): boolean {
    const result = db
      .update(parkingSpot)
      .set({
        status: SpotStatus.OCCUPIED,
        version: sql`${parkingSpot.version} + 1`,
      })
      .where(
        and(
          eq(parkingSpot.id, spotId),
          eq(parkingSpot.status, SpotStatus.AVAILABLE),
        ),
      )
      .run();
    return result.changes === 1;
  }

  /**
   * Claim the smallest-fitting available spot for the given vehicle.
   *
   * Walks compatible spot types from smallest to largest. For each size,
   * scans a small batch of candidates and tries to atomically claim
   * them. Falls back to larger sizes only after smaller sizes are
   * exhausted.
   */
  allocate(
    db: DB,
    args: { lotId: number; vehicleType: VehicleType },
  ): number {
    const batch = Math.max(8, this.settings.allocationMaxRetries * 2);

    for (const spotType of compatibleSpotTypes(args.vehicleType)) {
      for (let retry = 0; retry < this.settings.allocationMaxRetries; retry++) {
        const candidates = this.candidateSpots(db, {
          lotId: args.lotId,
          spotType,
          limit: batch,
        });
        if (candidates.length === 0) break; // try the next-larger size

        for (const c of candidates) {
          if (this.tryClaim(db, c.id)) {
            return c.id;
          }
        }
        // Lost every race in this batch — refresh and try again.
      }
    }

    throw new NoSpotAvailable(
      `No available spot for vehicle type ${args.vehicleType} in lot ${args.lotId}`,
    );
  }

  /** Mark a spot AVAILABLE again. Idempotent and safe to call twice. */
  release(db: DB, spotId: number): void {
    db.update(parkingSpot)
      .set({
        status: SpotStatus.AVAILABLE,
        version: sql`${parkingSpot.version} + 1`,
      })
      .where(
        and(
          eq(parkingSpot.id, spotId),
          eq(parkingSpot.status, SpotStatus.OCCUPIED),
        ),
      )
      .run();
  }
}
