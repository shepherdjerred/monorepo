import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { testOperator } from "#testing/seed.ts";
import { registerTestService } from "#testing/services.ts";

/**
 * Two services only the v2 catalog declares, registered as a reconcile leaves
 * them, so the overview has a catalog group of several services: Flipt with a
 * production environment nothing was deployed to, and 1Password Connect with
 * no environment. No spec deploys to either, so the group's counts hold.
 */
export async function seedOverviewGroup(
  delivery: Delivery,
  database: Database,
) {
  await registerTestService(database, "flipt");
  await registerTestService(database, "1password");
  await delivery.registerPipeline(
    "flipt/1",
    { kind: "manual", reason: "Overview fixture: nothing deploys here" },
    testOperator,
  );
  await delivery.registerEnvironment(
    {
      id: "flipt/prod",
      serviceId: "flipt",
      name: "prod",
      pipelineRevisionId: "flipt/1",
      configurationRevision: "flipt/config/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
}
