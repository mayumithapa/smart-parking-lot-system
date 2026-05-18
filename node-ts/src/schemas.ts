/**
 * Zod schemas — runtime validation + compile-time TS types.
 *
 * Fastify routes use `.body`, `.params`, and `.response` from these
 * schemas via `fastify-type-provider-zod`, so the API surface is fully
 * typed end-to-end.
 */

import { z } from "zod";

import { SpotType, VehicleType } from "./types/enums.js";

const VehicleTypeSchema = z.nativeEnum(VehicleType);
const SpotTypeSchema = z.nativeEnum(SpotType);

// ---------- Setup / admin ----------

export const SpotCreateSchema = z.object({
  code: z.string().min(1).max(30),
  spot_type: SpotTypeSchema,
});

export const FloorCreateSchema = z.object({
  number: z.number().int(),
  name: z.string().nullable().optional(),
  spots: z.array(SpotCreateSchema).default([]),
});

export const LotCreateSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().nullable().optional(),
  floors: z.array(FloorCreateSchema).default([]),
});

export const LotResponseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  address: z.string().nullable(),
  floor_count: z.number().int(),
  spot_count: z.number().int(),
});

// ---------- Check-in ----------

export const CheckInSchema = z.object({
  license_plate: z.string().min(1).max(20),
  vehicle_type: VehicleTypeSchema,
  lot_id: z.number().int(),
});

export const CheckInResponseSchema = z.object({
  ticket_id: z.number().int(),
  vehicle_id: z.number().int(),
  spot_id: z.number().int(),
  spot_code: z.string(),
  floor_number: z.number().int(),
  entry_time: z.string(),
});

// ---------- Check-out ----------

export const CheckOutSchema = z.object({
  ticket_id: z.number().int(),
  exit_time: z.string().datetime().optional(),
});

export const CheckOutResponseSchema = z.object({
  ticket_id: z.number().int(),
  entry_time: z.string(),
  exit_time: z.string(),
  duration_minutes: z.number().int(),
  amount: z.number(),
  spot_id: z.number().int(),
});

// ---------- Availability ----------

export const AvailabilityRowSchema = z.object({
  spot_type: SpotTypeSchema,
  available: z.number().int(),
  total: z.number().int(),
});

export const AvailabilityResponseSchema = z.object({
  lot_id: z.number().int(),
  rows: z.array(AvailabilityRowSchema),
});

export const LotIdParamSchema = z.object({
  lot_id: z.coerce.number().int(),
});

// ---------- Inferred TS types ----------

export type SpotCreate = z.infer<typeof SpotCreateSchema>;
export type FloorCreate = z.infer<typeof FloorCreateSchema>;
export type LotCreate = z.infer<typeof LotCreateSchema>;
export type LotResponse = z.infer<typeof LotResponseSchema>;
export type CheckInRequest = z.infer<typeof CheckInSchema>;
export type CheckInResponse = z.infer<typeof CheckInResponseSchema>;
export type CheckOutRequest = z.infer<typeof CheckOutSchema>;
export type CheckOutResponse = z.infer<typeof CheckOutResponseSchema>;
export type AvailabilityRow = z.infer<typeof AvailabilityRowSchema>;
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;
