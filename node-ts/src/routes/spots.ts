import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  AvailabilityResponseSchema,
  LotIdParamSchema,
} from "../schemas.js";
import { SpotType } from "../types/enums.js";
import type { AppContext } from "../app-context.js";

export async function spotsRoutes(fastify: FastifyInstance, ctx: AppContext) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/lots/:lot_id/availability",
    {
      schema: {
        tags: ["availability"],
        summary: "Real-time per-spot-type availability for a lot.",
        params: LotIdParamSchema,
        response: { 200: AvailabilityResponseSchema },
      },
    },
    async (req) => {
      const counts = ctx.parking.availability(ctx.db, req.params.lot_id);
      const rows = (Object.values(SpotType) as SpotType[]).map((st) => ({
        spot_type: st,
        available: counts[st]?.available ?? 0,
        total: counts[st]?.total ?? 0,
      }));
      return { lot_id: req.params.lot_id, rows };
    },
  );
}
