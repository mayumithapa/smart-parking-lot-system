/**
 * Drizzle ORM schema — mirrors the Python SQLAlchemy models 1:1.
 *
 * Every table that takes part in the allocation/check-in path has the
 * indexes the application's hot queries rely on (see ARCHITECTURE.md).
 */

import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const parkingLot = sqliteTable("parking_lot", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  address: text("address"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const floor = sqliteTable(
  "floor",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLot.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name"),
  },
  (t) => ({
    uniqLotNumber: uniqueIndex("uq_floor_lot_number").on(t.lotId, t.number),
    lotIdx: index("ix_floor_lot").on(t.lotId),
  }),
);

export const parkingSpot = sqliteTable(
  "parking_spot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    floorId: integer("floor_id")
      .notNull()
      .references(() => floor.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    spotType: text("spot_type").notNull(), // SpotType
    status: text("status").notNull().default("AVAILABLE"), // SpotStatus
    version: integer("version").notNull().default(0),
  },
  (t) => ({
    uniqFloorCode: uniqueIndex("uq_spot_floor_code").on(t.floorId, t.code),
    typeIdx: index("ix_spot_type").on(t.spotType),
    statusIdx: index("ix_spot_status").on(t.status),
  }),
);

export const vehicle = sqliteTable(
  "vehicle",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    licensePlate: text("license_plate").notNull().unique(),
    vehicleType: text("vehicle_type").notNull(), // VehicleType
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    plateIdx: index("ix_vehicle_plate").on(t.licensePlate),
  }),
);

export const parkingTicket = sqliteTable(
  "parking_ticket",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicle.id),
    spotId: integer("spot_id")
      .notNull()
      .references(() => parkingSpot.id),
    entryTime: text("entry_time")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    exitTime: text("exit_time"),
    amount: real("amount"),
    status: text("status").notNull().default("ACTIVE"), // TicketStatus
  },
  (t) => ({
    vehicleStatusIdx: index("ix_ticket_vehicle_status").on(
      t.vehicleId,
      t.status,
    ),
    spotStatusIdx: index("ix_ticket_spot_status").on(t.spotId, t.status),
  }),
);

export type ParkingLotRow = typeof parkingLot.$inferSelect;
export type FloorRow = typeof floor.$inferSelect;
export type ParkingSpotRow = typeof parkingSpot.$inferSelect;
export type VehicleRow = typeof vehicle.$inferSelect;
export type ParkingTicketRow = typeof parkingTicket.$inferSelect;
