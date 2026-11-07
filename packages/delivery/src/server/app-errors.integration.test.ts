import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createApp } from "./app.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  cluster = await createTestDatabase();
  app = createApp({
    delivery: new Delivery(cluster.database),
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "verified",
    peerAddress: () => "127.0.0.1",
    config: {
      publicOrigin: "http://delivery.test",
      machineCredentials: [],
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
    },
  });
  // Registered before the first request builds the matcher.
  app.post("/unique-violation-probe", () => {
    throw Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
  });
}, 60_000);

afterAll(async () => {
  await cluster.close();
});

/**
 * A concurrent duplicate, such as a second pending recovery intent for one
 * deployment, answered HTTP 500 INTERNAL before (AI-423).
 */
test("a unique-constraint violation answers 409 CONFLICT, not 500", async () => {
  const response = await app.request("/unique-violation-probe", {
    method: "POST",
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "CONFLICT" },
  });
});
