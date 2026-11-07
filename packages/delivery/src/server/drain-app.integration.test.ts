import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createTestApp } from "#testing/http-app.ts";
import { createDrain } from "./drain.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  cluster = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await cluster.close();
});

/**
 * The drain waits on requests the app actually serves: an API request that
 * arrives while it drains extends the drain, a probe does not. Requests are
 * sent through the real app while the drain sleeps on a controlled clock.
 */
test("a request the app serves while draining extends the drain; a probe does not", async () => {
  let clock = 0;
  const arrivals = [
    { at: 1000, path: "/api/v1/overview" },
    { at: 2500, path: "/readyz" },
  ];
  const statuses: Record<string, number> = {};
  const served: { app?: ReturnType<typeof createTestApp> } = {};
  const drain = createDrain({
    // Routing has already moved; only requests the app serves extend it.
    unrouted: async () => true,
    quietMs: 2000,
    maxMs: 25_000,
    now: () => clock,
    sleep: async (ms) => {
      const until = clock + ms;
      for (const arrival of arrivals) {
        if (
          served.app === undefined ||
          arrival.at <= clock ||
          arrival.at > until
        )
          continue;
        clock = arrival.at;
        const response = await served.app.request(arrival.path);
        statuses[arrival.path] = response.status;
      }
      clock = until;
    },
  });
  served.app = createTestApp(
    new Delivery(cluster.database),
    {
      machineCredentials: [],
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
    },
    undefined,
    drain,
  );

  await drain.untilDrained();
  // The API request at 1s restarts the 2s quiet window; the probe at 2.5s
  // does not, so the drain ends at 3s rather than 2s or 4.5s.
  expect(clock).toBe(3000);
  expect(statuses).toEqual({ "/api/v1/overview": 403, "/readyz": 503 });
});
