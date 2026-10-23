import { createTestDatabase } from "#testing/postgres.ts";
import { z } from "zod";
import { Delivery } from "#infrastructure/delivery.ts";
import { MachineCredentialSchema } from "#infrastructure/config.ts";
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
    // Optional disposable machine tokens, so toolkit verbs can be run
    // against this harness; none are accepted unless the variable is set.
    machineCredentials: z
      .array(MachineCredentialSchema)
      .parse(
        JSON.parse(Bun.env["DELIVERY_HARNESS_MACHINE_CREDENTIALS"] ?? "[]"),
      ),
  });
} catch (error) {
  await cluster.close();
  throw error;
}
