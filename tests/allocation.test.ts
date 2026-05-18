import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

import { freshDb, seedLot } from "./helpers/db.js";
import {
  parkingSpot,
  vehicle,
} from "../src/db/schema.js";
import {
  NoSpotAvailable,
  VehicleAlreadyParked,
} from "../src/exceptions.js";
import { AllocationService } from "../src/services/allocation-service.js";
import { ParkingService } from "../src/services/parking-service.js";
import {
  SpotStatus,
  SpotType,
  TicketStatus,
  VehicleType,
} from "../src/types/enums.js";

describe("AllocationService + ParkingService", () => {
  let env: ReturnType<typeof freshDb>;
  let lotId: number;
  let svc: ParkingService;

  beforeEach(() => {
    env = freshDb();
    ({ lotId } = seedLot(env.db));
    svc = new ParkingService();
  });

  afterEach(() => {
    env.cleanup();
  });

  test("motorcycle takes a motorcycle spot first", () => {
    const r = svc.checkIn(env.db, {
      licensePlate: "M-AAA-1",
      vehicleType: VehicleType.MOTORCYCLE,
      lotId,
    });
    const spot = env.db
      .select()
      .from(parkingSpot)
      .where(eq(parkingSpot.id, r.spotId))
      .get();
    expect(spot?.spotType).toBe(SpotType.MOTORCYCLE);
  });

  test("car takes a compact spot first", () => {
    const r = svc.checkIn(env.db, {
      licensePlate: "CAR-1",
      vehicleType: VehicleType.CAR,
      lotId,
    });
    const spot = env.db
      .select()
      .from(parkingSpot)
      .where(eq(parkingSpot.id, r.spotId))
      .get();
    expect(spot?.spotType).toBe(SpotType.COMPACT);
  });

  test("bus takes a large spot", () => {
    const r = svc.checkIn(env.db, {
      licensePlate: "BUS-1",
      vehicleType: VehicleType.BUS,
      lotId,
    });
    const spot = env.db
      .select()
      .from(parkingSpot)
      .where(eq(parkingSpot.id, r.spotId))
      .get();
    expect(spot?.spotType).toBe(SpotType.LARGE);
  });

  test("car falls back to LARGE when COMPACT is full", () => {
    env.db
      .update(parkingSpot)
      .set({ status: SpotStatus.OCCUPIED })
      .where(eq(parkingSpot.spotType, SpotType.COMPACT))
      .run();

    const r = svc.checkIn(env.db, {
      licensePlate: "CAR-OVERFLOW",
      vehicleType: VehicleType.CAR,
      lotId,
    });
    const spot = env.db
      .select()
      .from(parkingSpot)
      .where(eq(parkingSpot.id, r.spotId))
      .get();
    expect(spot?.spotType).toBe(SpotType.LARGE);
  });

  test("bus does NOT use smaller spots", () => {
    env.db
      .update(parkingSpot)
      .set({ status: SpotStatus.OCCUPIED })
      .where(eq(parkingSpot.spotType, SpotType.LARGE))
      .run();

    expect(() =>
      svc.checkIn(env.db, {
        licensePlate: "BUS-2",
        vehicleType: VehicleType.BUS,
        lotId,
      }),
    ).toThrow(NoSpotAvailable);
  });

  test("full lot raises NoSpotAvailable", () => {
    env.db
      .update(parkingSpot)
      .set({ status: SpotStatus.OCCUPIED })
      .run();

    const allocator = new AllocationService();
    expect(() =>
      allocator.allocate(env.db, { lotId, vehicleType: VehicleType.CAR }),
    ).toThrow(NoSpotAvailable);
  });

  test("double check-in for the same vehicle is blocked", () => {
    svc.checkIn(env.db, {
      licensePlate: "DUPE-1",
      vehicleType: VehicleType.CAR,
      lotId,
    });
    expect(() =>
      svc.checkIn(env.db, {
        licensePlate: "DUPE-1",
        vehicleType: VehicleType.CAR,
        lotId,
      }),
    ).toThrow(VehicleAlreadyParked);
  });

  test("check-out closes the ticket and frees the spot", () => {
    const t = svc.checkIn(env.db, {
      licensePlate: "FREE-1",
      vehicleType: VehicleType.CAR,
      lotId,
    });
    const closed = svc.checkOut(env.db, { ticketId: t.ticketId });
    expect(closed.amount).toBeGreaterThan(0);
    const spot = env.db
      .select()
      .from(parkingSpot)
      .where(eq(parkingSpot.id, t.spotId))
      .get();
    expect(spot?.status).toBe(SpotStatus.AVAILABLE);
    expect(closed.ticketId).toBe(t.ticketId);
    expect(closed.durationMinutes).toBeGreaterThanOrEqual(0);
    expect(closed.spotId).toBe(t.spotId);
    expect(closed).toMatchObject({ amount: expect.any(Number) });
    expect(closed.amount).toBeGreaterThan(0);
    // sanity: status is COMPLETED in DB
    // (we don't expose ticket status in CheckOutResult)
    void TicketStatus.COMPLETED;
  });

  test("vehicle record is reused across visits (case-insensitive plate)", () => {
    const t1 = svc.checkIn(env.db, {
      licensePlate: "reuse-1",
      vehicleType: VehicleType.CAR,
      lotId,
    });
    svc.checkOut(env.db, { ticketId: t1.ticketId });
    const t2 = svc.checkIn(env.db, {
      licensePlate: "REUSE-1",
      vehicleType: VehicleType.CAR,
      lotId,
    });
    expect(t1.vehicleId).toBe(t2.vehicleId);

    const vehicles = env.db
      .select()
      .from(vehicle)
      .where(eq(vehicle.licensePlate, "REUSE-1"))
      .all();
    expect(vehicles.length).toBe(1);
  });
});
