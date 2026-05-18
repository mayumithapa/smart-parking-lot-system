/**
 * Fastify app factory — exported separately from main.ts so tests can
 * spin up the app without binding to a port.
 */

import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { type AppContext, createContext } from "./app-context.js";
import { ParkingError } from "./exceptions.js";
import { adminRoutes } from "./routes/admin.js";
import { parkingRoutes } from "./routes/parking.js";
import { spotsRoutes } from "./routes/spots.js";

export async function buildApp(args: {
  ctx: AppContext;
  withSwagger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (args.withSwagger ?? true) {
    const swagger = (await import("@fastify/swagger")).default;
    const swaggerUi = (await import("@fastify/swagger-ui")).default;
    await app.register(swagger, {
      // Convert Zod route schemas to JSON Schema so @fastify/swagger can
      // emit a valid OpenAPI 3 spec at /docs/json.
      transform: jsonSchemaTransform,
      openapi: {
        info: {
          title: "Smart Parking Lot — Node.js",
          description:
            "Backend system for a smart, multi-floor parking lot. " +
            "Vehicle-aware spot allocation, hourly fee calculation, " +
            "real-time availability, concurrency-safe via atomic " +
            "conditional UPDATE.",
          version: "0.1.0",
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.setErrorHandler((error: unknown, _req, reply) => {
    if (error instanceof ParkingError) {
      return reply.code(error.statusCode).send({ message: error.message });
    }
    const e = error as { validation?: unknown; message?: string };
    if (e.validation) {
      return reply.code(400).send({
        message: "Validation failed",
        details: e.message,
      });
    }
    reply.send(error as Error);
  });

  app.get("/health", { schema: { tags: ["meta"] } }, async () => ({
    status: "ok",
  }));

  app.get("/", { schema: { tags: ["meta"] } }, async () => ({
    name: "Smart Parking Lot — Node.js",
    version: "0.1.0",
    docs: "/docs",
    openapi: "/docs/json",
    endpoints: {
      create_lot: "POST /api/v1/admin/lots",
      check_in: "POST /api/v1/parking/check-in",
      check_out: "POST /api/v1/parking/check-out",
      availability: "GET /api/v1/lots/{lot_id}/availability",
    },
  }));

  await app.register(
    async (instance) => {
      await adminRoutes(instance, args.ctx);
      await parkingRoutes(instance, args.ctx);
      await spotsRoutes(instance, args.ctx);
    },
    { prefix: "/api/v1" },
  );

  return app;
}

export function createAppContextFromEnv() {
  // Lazy-import to keep test code from accidentally opening the prod DB.
  return import("./db/index.js").then(({ createDb, initSchema }) => {
    const { db, sqlite } = createDb();
    initSchema(sqlite);
    return createContext({ db, sqlite });
  });
}
