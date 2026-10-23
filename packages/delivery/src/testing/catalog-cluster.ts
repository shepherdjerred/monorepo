import { afterAll, beforeAll, beforeEach } from "vitest";
import { Delivery } from "#infrastructure/delivery.ts";
import { resetDeliveryTables } from "./delivery-http-fixture.ts";
import { createTestDatabase } from "./postgres.ts";

/**
 * One disposable cluster per catalog test file and a Delivery over it, with
 * every table reset before each test and only the test catalog's services
 * registered: catalog reconcile creates the rest.
 */
export function useCatalogCluster() {
  let state:
    | {
        cluster: Awaited<ReturnType<typeof createTestDatabase>>;
        delivery: Delivery;
      }
    | undefined;
  const current = () => {
    if (state === undefined)
      throw new Error("The catalog cluster starts in beforeAll");
    return state;
  };
  beforeAll(async () => {
    const cluster = await createTestDatabase();
    state = { cluster, delivery: new Delivery(cluster.database) };
  }, 60_000);
  afterAll(async () => {
    await current().cluster.close();
  });
  beforeEach(async () => {
    await resetDeliveryTables(current().cluster.database);
  });
  return {
    get cluster() {
      return current().cluster;
    },
    get delivery() {
      return current().delivery;
    },
  };
}
