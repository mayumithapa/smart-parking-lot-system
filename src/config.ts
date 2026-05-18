/**
 * Runtime configuration — read once from environment at startup.
 *
 * Defaults are tuned for local development (file-backed SQLite). Set
 * DATABASE_URL to a Postgres connection string in production to take
 * advantage of row-level locking.
 */

import { z } from "zod";

const SettingsSchema = z.object({
  appName: z.string().default("Smart Parking Lot"),
  databaseUrl: z.string().default("file:./parking.db"),

  feeMotorcyclePerHour: z.coerce.number().default(1.0),
  feeCarPerHour: z.coerce.number().default(2.0),
  feeBusPerHour: z.coerce.number().default(5.0),

  feeMinimumMinutes: z.coerce.number().int().default(15),
  feeDailyCapHours: z.coerce.number().int().default(24),

  allocationMaxRetries: z.coerce.number().int().default(5),

  port: z.coerce.number().int().default(8000),
  host: z.string().default("127.0.0.1"),
});

export type Settings = z.infer<typeof SettingsSchema>;

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  cached = SettingsSchema.parse({
    appName: process.env.APP_NAME,
    databaseUrl: process.env.DATABASE_URL,
    feeMotorcyclePerHour: process.env.FEE_MOTORCYCLE_PER_HOUR,
    feeCarPerHour: process.env.FEE_CAR_PER_HOUR,
    feeBusPerHour: process.env.FEE_BUS_PER_HOUR,
    feeMinimumMinutes: process.env.FEE_MINIMUM_MINUTES,
    feeDailyCapHours: process.env.FEE_DAILY_CAP_HOURS,
    allocationMaxRetries: process.env.ALLOCATION_MAX_RETRIES,
    port: process.env.PORT,
    host: process.env.HOST,
  });
  return cached;
}

/** For tests — drop the cached settings so env-var changes take effect. */
export function resetSettings(): void {
  cached = null;
}
