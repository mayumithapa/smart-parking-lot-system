/**
 * Fee calculation.
 *
 *   fee = max(minimum_charge, ceil(minutes / 60) * hourly_rate)
 *
 * with an optional daily cap (defaults to 24h). Hourly rates and the
 * minimum charge are configurable; rates are keyed on `VehicleType`, so
 * adding a new vehicle class is a one-line change.
 */

import { getSettings, type Settings } from "../config.js";
import { VehicleType } from "../types/enums.js";

export interface FeeQuote {
  durationMinutes: number;
  chargeableHours: number;
  ratePerHour: number;
  amount: number;
}

export class FeeCalculator {
  private readonly settings: Settings;

  constructor(settings?: Settings) {
    this.settings = settings ?? getSettings();
  }

  private rateFor(vt: VehicleType): number {
    switch (vt) {
      case VehicleType.MOTORCYCLE:
        return this.settings.feeMotorcyclePerHour;
      case VehicleType.CAR:
        return this.settings.feeCarPerHour;
      case VehicleType.BUS:
        return this.settings.feeBusPerHour;
    }
  }

  /** Parse incoming datetimes (ISO string or Date) into a UTC epoch ms. */
  private toEpochMs(value: string | Date): number {
    const ms =
      typeof value === "string" ? Date.parse(value) : value.getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(`Invalid datetime: ${String(value)}`);
    }
    return ms;
  }

  quote(args: {
    vehicleType: VehicleType;
    entryTime: string | Date;
    exitTime: string | Date;
  }): FeeQuote {
    const entry = this.toEpochMs(args.entryTime);
    const exit = this.toEpochMs(args.exitTime);
    if (exit < entry) {
      throw new Error("exitTime must be >= entryTime");
    }

    const deltaSeconds = (exit - entry) / 1000;
    // Round duration up to the next whole minute — never under-charge by a
    // few seconds.
    const durationMinutes = Math.max(0, Math.ceil(deltaSeconds / 60));

    // Apply minimum chargeable duration.
    const chargeableMinutes = Math.max(
      durationMinutes,
      this.settings.feeMinimumMinutes,
    );

    // Round hours up — a 1h05m stay pays for 2h.
    let chargeableHours = Math.max(1, Math.ceil(chargeableMinutes / 60));
    chargeableHours = Math.min(chargeableHours, this.settings.feeDailyCapHours);

    const rate = this.rateFor(args.vehicleType);
    const amount = Math.round(chargeableHours * rate * 100) / 100;

    return { durationMinutes, chargeableHours, ratePerHour: rate, amount };
  }
}
