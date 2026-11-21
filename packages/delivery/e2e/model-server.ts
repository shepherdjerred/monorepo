import { createTestDatabase } from "#testing/postgres.ts";
import { z } from "zod";
import { Delivery } from "#infrastructure/delivery.ts";
import { MachineCredentialSchema } from "#infrastructure/config.ts";
import { serveHarness } from "./harness.ts";
import {
  MODEL_ACCEPTED_IMAGE,
  MODEL_ENVIRONMENTS,
  seedModelBrowser,
} from "./model.ts";
import { describeSeededCommits } from "./commits.ts";

const harnessPort = Number(
  Bun.argv[2] ?? Bun.env["DELIVERY_MODEL_E2E_PORT"] ?? "17355",
);
if (
  !Number.isSafeInteger(harnessPort) ||
  harnessPort < 1 ||
  harnessPort > 65_535
) {
  throw new Error("DELIVERY_MODEL_E2E_PORT must be a valid TCP port");
}

// This executable is an isolated acceptance harness, never a production
// entrypoint. Its catalog owns every environment of its own database, so the
// model specs never share state with the release harness.
const cluster = await createTestDatabase();
try {
  const delivery = new Delivery(cluster.database);
  await seedModelBrowser(delivery, cluster.database);
  await describeSeededCommits(delivery);
  await serveHarness({
    cluster,
    delivery,
    port: harnessPort,
    enabledEnvironments: MODEL_ENVIRONMENTS,
    // Both Arcade Applications run the image their environment accepted.
    liveImages: {
      arcade: [MODEL_ACCEPTED_IMAGE],
      "arcade-beta": [MODEL_ACCEPTED_IMAGE],
    },
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
