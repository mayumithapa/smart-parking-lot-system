import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";

import { createContext } from "../src/app-context.js";
import { buildApp } from "../src/app.js";
import { freshDb } from "./helpers/db.js";

describe("HTTP API end-to-end", () => {
  let env: ReturnType<typeof freshDb>;
  let app: FastifyInstance;

  beforeEach(async () => {
    env = freshDb();
    const ctx = createContext({ db: env.db, sqlite: env.sqlite });
    app = await buildApp({ ctx, withSwagger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    env.cleanup();
  });

  async function createLot(): Promise<number> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/lots",
      payload: {
        name: "API Lot",
        floors: [
          {
            number: 1,
            spots: [
              { code: "M-1", spot_type: "MOTORCYCLE" },
              { code: "C-1", spot_type: "COMPACT" },
              { code: "C-2", spot_type: "COMPACT" },
              { code: "L-1", spot_type: "LARGE" },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as number;
  }

  test("/health responds", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: "ok" });
  });

  test("full happy-path flow", async () => {
    const lotId = await createLot();

    let r = await app.inject({
      method: "GET",
      url: `/api/v1/lots/${lotId}/availability`,
    });
    expect(r.statusCode).toBe(200);
    let body = r.json() as {
      rows: Array<{ spot_type: string; available: number; total: number }>;
    };
    const before = Object.fromEntries(
      body.rows.map((row) => [row.spot_type, row]),
    );
    expect(before.COMPACT?.available).toBe(2);

    r = await app.inject({
      method: "POST",
      url: "/api/v1/parking/check-in",
      payload: {
        license_plate: "API-1",
        vehicle_type: "CAR",
        lot_id: lotId,
      },
    });
    expect(r.statusCode).toBe(201);
    const ticketId = (r.json() as { ticket_id: number }).ticket_id;

    r = await app.inject({
      method: "GET",
      url: `/api/v1/lots/${lotId}/availability`,
    });
    body = r.json();
    const mid = Object.fromEntries(
      body.rows.map((row) => [row.spot_type, row]),
    );
    expect(mid.COMPACT?.available).toBe(1);

    r = await app.inject({
      method: "POST",
      url: "/api/v1/parking/check-out",
      payload: {
        ticket_id: ticketId,
        exit_time: "2030-01-01T03:30:00.000Z",
      },
    });
    expect(r.statusCode).toBe(200);
    const out = r.json() as { amount: number; spot_id: number };
    expect(out.amount).toBeGreaterThan(0);
    expect(out.spot_id).toBeTruthy();

    r = await app.inject({
      method: "GET",
      url: `/api/v1/lots/${lotId}/availability`,
    });
    body = r.json();
    const after = Object.fromEntries(
      body.rows.map((row) => [row.spot_type, row]),
    );
    expect(after.COMPACT?.available).toBe(2);
  });

  test("double check-in returns 409", async () => {
    const lotId = await createLot();
    let r = await app.inject({
      method: "POST",
      url: "/api/v1/parking/check-in",
      payload: { license_plate: "DUP-1", vehicle_type: "CAR", lot_id: lotId },
    });
    expect(r.statusCode).toBe(201);

    r = await app.inject({
      method: "POST",
      url: "/api/v1/parking/check-in",
      payload: { license_plate: "DUP-1", vehicle_type: "CAR", lot_id: lotId },
    });
    expect(r.statusCode).toBe(409);
  });

  test("full lot returns 409", async () => {
    const lotId = await createLot();

    // Lot has 1 motorcycle spot — fill it.
    let r = await app.inject({
      method: "POST",
      url: "/api/v1/parking/check-in",
      payload: { license_plate: "M-1", vehicle_type: "MOTORCYCLE", lot_id: lotId },
    });
    expect(r.statusCode).toBe(201);
    // motorcycles fall back into compacts and large until everything is full
    for (const plate of ["M-2", "M-3", "M-4"]) {
      r = await app.inject({
        method: "POST",
        url: "/api/v1/parking/check-in",
        payload: { license_plate: plate, vehicle_type: "MOTORCYCLE", lot_id: lotId },
      });
      expect(r.statusCode).toBe(201);
    }
    r = await app.inject({
      method: "POST",
      url: "/api/v1/parking/check-in",
      payload: { license_plate: "M-5", vehicle_type: "MOTORCYCLE", lot_id: lotId },
    });
    expect(r.statusCode).toBe(409);
  });
});
