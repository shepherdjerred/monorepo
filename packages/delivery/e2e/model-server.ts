import { createTestDatabase } from "#testing/postgres.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { serveHarness } from "./harness.ts";
import { MODEL_ENVIRONMENTS, seedModelBrowser } from "./model.ts";

// This executable is an isolated acceptance harness, never a production
// entrypoint. Its catalog owns every environment of its own database, so the
// model specs never share state with the release harness.
const cluster = await createTestDatabase();
try {
  const delivery = new Delivery(cluster.database);
  await seedModelBrowser(delivery, cluster.database);
  await serveHarness({
    cluster,
    delivery,
    port: 17_355,
    enabledEnvironments: MODEL_ENVIRONMENTS,
  });
} catch (error) {
  await cluster.close();
  throw error;
}
