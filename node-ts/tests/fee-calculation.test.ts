import { describe, expect, test } from "vitest";

import { FeeCalculator } from "../src/services/fee-service.js";
import { VehicleType } from "../src/types/enums.js";

const BASE = new Date("2026-01-01T12:00:00Z").getTime();

function at(args: { hours?: number; minutes?: number }) {
  const ms = BASE + (args.hours ?? 0) * 3600_000 + (args.minutes ?? 0) * 60_000;
  return new Date(ms).toISOString();
}

describe("FeeCalculator", () => {
  test("minimum charge applies for very short stays", () => {
    const fees = new FeeCalculator();
    const q = fees.quote({
      vehicleType: VehicleType.CAR,
      entryTime: at({}),
      exitTime: at({ minutes: 2 }),
    });
    expect(q.durationMinutes).toBe(2);
    expect(q.chargeableHours).toBe(1); // bumped via minimum + ceil
    expect(q.amount).toBe(2.0);
  });

  test("partial hour rounds up", () => {
    const fees = new FeeCalculator();
    const q = fees.quote({
      vehicleType: VehicleType.CAR,
      entryTime: at({}),
      exitTime: at({ hours: 1, minutes: 5 }),
    });
    expect(q.chargeableHours).toBe(2);
    expect(q.amount).toBe(4.0);
  });

  test("motorcycle rate is cheaper than car", () => {
    const fees = new FeeCalculator();
    const car = fees.quote({
      vehicleType: VehicleType.CAR,
      entryTime: at({}),
      exitTime: at({ hours: 3 }),
    });
    const moto = fees.quote({
      vehicleType: VehicleType.MOTORCYCLE,
      entryTime: at({}),
      exitTime: at({ hours: 3 }),
    });
    expect(moto.amount).toBeLessThan(car.amount);
  });

  test("bus rate is more expensive than car", () => {
    const fees = new FeeCalculator();
    const car = fees.quote({
      vehicleType: VehicleType.CAR,
      entryTime: at({}),
      exitTime: at({ hours: 2 }),
    });
    const bus = fees.quote({
      vehicleType: VehicleType.BUS,
      entryTime: at({}),
      exitTime: at({ hours: 2 }),
    });
    expect(bus.amount).toBeGreaterThan(car.amount);
  });

  test("daily cap clamps very long stays", () => {
    const fees = new FeeCalculator();
    const q = fees.quote({
      vehicleType: VehicleType.CAR,
      entryTime: at({}),
      exitTime: at({ hours: 72 }),
    });
    expect(q.chargeableHours).toBe(24);
    expect(q.amount).toBe(48.0);
  });

  test("negative duration is rejected", () => {
    const fees = new FeeCalculator();
    expect(() =>
      fees.quote({
        vehicleType: VehicleType.CAR,
        entryTime: at({ hours: 2 }),
        exitTime: at({ hours: 1 }),
      }),
    ).toThrowError(/exitTime/);
  });

  test("custom rates are honored", () => {
    const fees = new FeeCalculator({
      appName: "x",
      databaseUrl: "file::memory:",
      feeMotorcyclePerHour: 1,
      feeCarPerHour: 10,
      feeBusPerHour: 5,
      feeMinimumMinutes: 15,
      feeDailyCapHours: 24,
      allocationMaxRetries: 5,
      port: 0,
      host: "127.0.0.1",
    });
    const q = fees.quote({
      vehicleType: VehicleType.CAR,
      entryTime: at({}),
      exitTime: at({ hours: 1 }),
    });
    expect(q.amount).toBe(10);
  });
});
