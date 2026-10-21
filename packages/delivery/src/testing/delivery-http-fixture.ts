import { afterAll, beforeAll, beforeEach } from "vitest";
import type { RuntimeConfig } from "#infrastructure/config.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createApp } from "#server/app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { createTestDatabase } from "./postgres.ts";

type TestCluster = Awaited<ReturnType<typeof createTestDatabase>>;

/** Empties every Delivery-owned table so each test starts from a blank control plane. */
export async function resetDeliveryTables(database: TestCluster["database"]) {
  await database.$executeRawUnsafe(
    'TRUNCATE "ApplicationLock", "Outbox", "Evidence", "Approval", "Stage", "Deployment", "Environment", "Pipeline", "VersionSetEntry", "VersionSet", "Artifact", "Build", "Request", "Audit", "ImportedSnapshot" CASCADE',
  );
}

/**
 * Each calling test file owns one disposable cluster, a Delivery over it, and
 * the real HTTP application served in-process with no operators and no trusted
 * proxies. `client()` speaks to that application as `defaultToken`'s principal.
 */
export function useDeliveryHttp(options: {
  machineCredentials: RuntimeConfig["machineCredentials"];
  writesEnabled: boolean;
  defaultToken: string;
}) {
  let cluster: TestCluster;
  let delivery: Delivery;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(cluster.database);
    app = createApp({
      delivery,
      ciOrigin: "https://woodpecker.sjer.red",
      ciRepositoryId: 1,
      qualifyBuild: () => Promise.resolve("verified"),
      peerAddress: () => "127.0.0.1",
      config: {
        publicOrigin: "http://delivery.test",
        machineCredentials: options.machineCredentials,
        writesEnabled: () => Promise.resolve(options.writesEnabled),
        enabledEnvironments: () => Promise.resolve([]),
        trustedProxyAddresses: () => Promise.resolve([]),
        operatorLogins: () => Promise.resolve([]),
      },
    });
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });
  beforeEach(async () => {
    await resetDeliveryTables(cluster.database);
  });
  return {
    get cluster() {
      return cluster;
    },
    get delivery() {
      return delivery;
    },
    get app() {
      return app;
    },
    client: (token = options.defaultToken) =>
      createDeliveryClient({
        baseUrl: "http://delivery.test",
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => Promise.resolve(app.request(input, init)),
      }),
  };
}
