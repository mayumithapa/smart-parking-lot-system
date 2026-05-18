/**
 * ParkingService — orchestrates check-in / check-out flows.
 */

import { and, eq, sql } from "drizzle-orm";

import type { DB } from "../db/index.js";
import {
  floor,
  parkingSpot,
  parkingTicket,
  vehicle,
} from "../db/schema.js";
import {
  TicketAlreadyClosed,
  TicketNotFound,
  VehicleAlreadyParked,
} from "../exceptions.js";
import {
  SpotStatus,
  type SpotType,
  TicketStatus,
  type VehicleType,
} from "../types/enums.js";
import { AllocationService } from "./allocation-service.js";
import { FeeCalculator } from "./fee-service.js";

export interface CheckInResult {
  ticketId: number;
  vehicleId: number;
  spotId: number;
  spotCode: string;
  floorNumber: number;
  entryTime: string;
}

export interface CheckOutResult {
  ticketId: number;
  entryTime: string;
  exitTime: string;
  durationMinutes: number;
  amount: number;
  spotId: number;
}

export interface AvailabilityCounts {
  [spotType: string]: { total: number; available: number };
}

export class ParkingService {
  private readonly allocator: AllocationService;
  private readonly fees: FeeCalculator;

  constructor(allocator?: AllocationService, fees?: FeeCalculator) {
    this.allocator = allocator ?? new AllocationService();
    this.fees = fees ?? new FeeCalculator();
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private getOrCreateVehicle(
    db: DB,
    args: { licensePlate: string; vehicleType: VehicleType },
  ): { id: number; vehicleType: VehicleType; licensePlate: string } {
    const plate = args.licensePlate.trim().toUpperCase();
    const existing = db
      .select()
      .from(vehicle)
      .where(eq(vehicle.licensePlate, plate))
      .get();

    if (existing) {
      return {
        id: existing.id,
        vehicleType: existing.vehicleType as VehicleType,
        licensePlate: existing.licensePlate,
      };
    }

    try {
      const inserted = db
        .insert(vehicle)
        .values({ licensePlate: plate, vehicleType: args.vehicleType })
        .returning({ id: vehicle.id })
        .get();
      return {
        id: inserted!.id,
        vehicleType: args.vehicleType,
        licensePlate: plate,
      };
    } catch {
      // Another concurrent insert won — re-read.
      const v = db
        .select()
        .from(vehicle)
        .where(eq(vehicle.licensePlate, plate))
        .get();
      if (!v) throw new Error(`Failed to create vehicle ${plate}`);
      return {
        id: v.id,
        vehicleType: v.vehicleType as VehicleType,
        licensePlate: v.licensePlate,
      };
    }
  }

  private hasActiveTicket(db: DB, vehicleId: number): boolean {
    const row = db
      .select({ id: parkingTicket.id })
      .from(parkingTicket)
      .where(
        and(
          eq(parkingTicket.vehicleId, vehicleId),
          eq(parkingTicket.status, TicketStatus.ACTIVE),
        ),
      )
      .get();
    return !!row;
  }

  checkIn(
    db: DB,
    args: { licensePlate: string; vehicleType: VehicleType; lotId: number },
  ): CheckInResult {
    const v = this.getOrCreateVehicle(db, args);

    if (this.hasActiveTicket(db, v.id)) {
      throw new VehicleAlreadyParked(
        `Vehicle ${v.licensePlate} already has an active ticket`,
      );
    }

    // AllocationService either succeeds or throws NoSpotAvailable.
    const spotId = this.allocator.allocate(db, {
      lotId: args.lotId,
      vehicleType: args.vehicleType,
    });

    let ticketId: number;
    let entryTime: string;
    try {
      const inserted = db
        .insert(parkingTicket)
        .values({
          vehicleId: v.id,
          spotId,
          status: TicketStatus.ACTIVE,
          entryTime: this.nowIso(),
        })
        .returning({ id: parkingTicket.id, entryTime: parkingTicket.entryTime })
        .get();
      ticketId = inserted!.id;
      entryTime = inserted!.entryTime;
    } catch (err) {
      // Compensate: release the spot we just claimed.
      this.allocator.release(db, spotId);
      throw err;
    }

    const spot = db
      .select({
        spotCode: parkingSpot.code,
        floorNumber: floor.number,
      })
      .from(parkingSpot)
      .innerJoin(floor, eq(parkingSpot.floorId, floor.id))
      .where(eq(parkingSpot.id, spotId))
      .get();

    return {
      ticketId,
      vehicleId: v.id,
      spotId,
      spotCode: spot!.spotCode,
      floorNumber: spot!.floorNumber,
      entryTime,
    };
  }

  checkOut(
    db: DB,
    args: { ticketId: number; exitTime?: string | Date },
  ): CheckOutResult {
    const ticket = db
      .select({
        id: parkingTicket.id,
        spotId: parkingTicket.spotId,
        vehicleId: parkingTicket.vehicleId,
        entryTime: parkingTicket.entryTime,
        status: parkingTicket.status,
      })
      .from(parkingTicket)
      .where(eq(parkingTicket.id, args.ticketId))
      .get();

    if (!ticket) {
      throw new TicketNotFound(`Ticket ${args.ticketId} not found`);
    }
    if (ticket.status !== TicketStatus.ACTIVE) {
      throw new TicketAlreadyClosed(
        `Ticket ${args.ticketId} is not active (status=${ticket.status})`,
      );
    }

    const v = db
      .select({ vehicleType: vehicle.vehicleType })
      .from(vehicle)
      .where(eq(vehicle.id, ticket.vehicleId))
      .get();

    const exitTime = args.exitTime
      ? typeof args.exitTime === "string"
        ? args.exitTime
        : args.exitTime.toISOString()
      : this.nowIso();

    const quote = this.fees.quote({
      vehicleType: v!.vehicleType as VehicleType,
      entryTime: ticket.entryTime,
      exitTime,
    });

    db.update(parkingTicket)
      .set({
        exitTime,
        amount: quote.amount,
        status: TicketStatus.COMPLETED,
      })
      .where(eq(parkingTicket.id, ticket.id))
      .run();

    // Free the spot AFTER the ticket is durably closed — see ARCHITECTURE.md
    // for why this ordering matters for crash recovery.
    this.allocator.release(db, ticket.spotId);

    const durationMinutes = quote.durationMinutes;

    return {
      ticketId: ticket.id,
      entryTime: ticket.entryTime,
      exitTime,
      durationMinutes,
      amount: quote.amount,
      spotId: ticket.spotId,
    };
  }

  availability(db: DB, lotId: number): AvailabilityCounts {
    const rows = db
      .select({
        spotType: parkingSpot.spotType,
        total: sql<number>`COUNT(*)`,
        available: sql<number>`SUM(CASE WHEN ${parkingSpot.status} = ${SpotStatus.AVAILABLE} THEN 1 ELSE 0 END)`,
      })
      .from(parkingSpot)
      .innerJoin(floor, eq(parkingSpot.floorId, floor.id))
      .where(eq(floor.lotId, lotId))
      .groupBy(parkingSpot.spotType)
      .all();

    const out: AvailabilityCounts = {};
    for (const r of rows) {
      out[r.spotType as SpotType] = {
        total: Number(r.total ?? 0),
        available: Number(r.available ?? 0),
      };
    }
    return out;
  }
}
