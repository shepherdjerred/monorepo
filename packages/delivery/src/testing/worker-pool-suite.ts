import { afterAll, beforeAll, beforeEach } from "vitest";
import { Delivery } from "#infrastructure/delivery.ts";
import { createTestDatabase } from "./postgres.ts";
import { workerFixture } from "./worker-fixture.ts";

type Suite = {
  cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  delivery: Delivery;
  fixture: Awaited<ReturnType<typeof workerFixture>>;
  /** Replaces this test's fixture with one for another worker target. */
  useTarget: (target: Parameters<typeof workerFixture>[1]) => Promise<void>;
};

function ready<T>(value: T | undefined, name: string): T {
  if (value === undefined)
    throw new Error(`Worker pool suite ${name} is not ready`);
  return value;
}

/**
 * One PostgreSQL database per file, truncated before each test, with a fresh
 * worker fixture: the shared setup of the worker-pool integration suites.
 */
export function workerPoolSuite(): Suite {
  let cluster: Suite["cluster"] | undefined;
  let delivery: Delivery | undefined;
  let fixture: Suite["fixture"] | undefined;
  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(cluster.database);
  }, 60_000);
  afterAll(async () => {
    await cluster?.close();
  });
  beforeEach(async () => {
    await ready(cluster, "database").database.$executeRawUnsafe(
      'TRUNCATE "Environment", "Pipeline", "Build", "VersionSet", "Request", "Audit" CASCADE',
    );
    fixture = await workerFixture(ready(delivery, "Delivery"));
  });
  return {
    get cluster() {
      return ready(cluster, "database");
    },
    get delivery() {
      return ready(delivery, "Delivery");
    },
    get fixture() {
      return ready(fixture, "fixture");
    },
    async useTarget(target) {
      fixture = await workerFixture(ready(delivery, "Delivery"), target);
    },
  };
}
