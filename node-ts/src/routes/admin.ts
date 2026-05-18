import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { floor, parkingLot, parkingSpot } from "../db/schema.js";
import {
  LotCreateSchema,
  LotResponseSchema,
} from "../schemas.js";
import type { AppContext } from "../app-context.js";

export async function adminRoutes(fastify: FastifyInstance, ctx: AppContext) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/admin/lots",
    {
      schema: {
        tags: ["admin"],
        summary: "Create a parking lot, its floors, and all spots in one shot.",
        body: LotCreateSchema,
        response: { 201: LotResponseSchema, 409: z.object({ message: z.string() }) },
      },
    },
    async (req, reply) => {
      const payload = req.body;
      const { db } = ctx;

      try {
        const result = db.transaction((tx) => {
          const lot = tx
            .insert(parkingLot)
            .values({ name: payload.name, address: payload.address ?? null })
            .returning({ id: parkingLot.id })
            .get();

          let spotCount = 0;
          for (const f of payload.floors ?? []) {
            const fl = tx
              .insert(floor)
              .values({
                lotId: lot!.id,
                number: f.number,
                name: f.name ?? null,
              })
              .returning({ id: floor.id })
              .get();

            for (const s of f.spots ?? []) {
              tx.insert(parkingSpot)
                .values({
                  floorId: fl!.id,
                  code: s.code,
                  spotType: s.spot_type,
                })
                .run();
              spotCount += 1;
            }
          }

          return { id: lot!.id, spotCount, floorCount: payload.floors.length };
        });

        return reply.code(201).send({
          id: result.id,
          name: payload.name,
          address: payload.address ?? null,
          floor_count: result.floorCount,
          spot_count: result.spotCount,
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE/i.test(err.message)) {
          return reply.code(409).send({ message: "Lot name already exists" });
        }
        throw err;
      }
    },
  );
}
