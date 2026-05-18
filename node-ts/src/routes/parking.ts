import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  CheckInResponseSchema,
  CheckInSchema,
  CheckOutResponseSchema,
  CheckOutSchema,
} from "../schemas.js";
import type { AppContext } from "../app-context.js";

const ErrorSchema = z.object({ message: z.string() });

export async function parkingRoutes(fastify: FastifyInstance, ctx: AppContext) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/parking/check-in",
    {
      schema: {
        tags: ["parking"],
        summary: "Allocate a spot and open a ticket.",
        body: CheckInSchema,
        response: {
          201: CheckInResponseSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const result = ctx.parking.checkIn(ctx.db, {
        licensePlate: req.body.license_plate,
        vehicleType: req.body.vehicle_type,
        lotId: req.body.lot_id,
      });
      return reply.code(201).send({
        ticket_id: result.ticketId,
        vehicle_id: result.vehicleId,
        spot_id: result.spotId,
        spot_code: result.spotCode,
        floor_number: result.floorNumber,
        entry_time: result.entryTime,
      });
    },
  );

  app.post(
    "/parking/check-out",
    {
      schema: {
        tags: ["parking"],
        summary: "Close a ticket, compute the fee, and free the spot.",
        body: CheckOutSchema,
        response: {
          200: CheckOutResponseSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const result = ctx.parking.checkOut(ctx.db, {
        ticketId: req.body.ticket_id,
        exitTime: req.body.exit_time,
      });
      return reply.code(200).send({
        ticket_id: result.ticketId,
        entry_time: result.entryTime,
        exit_time: result.exitTime,
        duration_minutes: result.durationMinutes,
        amount: result.amount,
        spot_id: result.spotId,
      });
    },
  );
}
