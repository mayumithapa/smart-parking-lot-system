/**
 * Application entry-point. Run with `npm run dev` (watch) or
 * `npm start`.
 */

import { buildApp, createAppContextFromEnv } from "./app.js";
import { getSettings } from "./config.js";

async function main() {
  const settings = getSettings();
  const ctx = await createAppContextFromEnv();
  const app = await buildApp({ ctx, withSwagger: true });

  await app.listen({ port: settings.port, host: settings.host });
  // eslint-disable-next-line no-console
  console.log(
    `Smart Parking Lot (Node.js) running on http://${settings.host}:${settings.port}`,
  );
  // eslint-disable-next-line no-console
  console.log(`Swagger UI: http://${settings.host}:${settings.port}/docs`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
