import { expect, test } from "vitest";
import { FlagsUsageResponseSchema } from "@shepherdjerred/feature-flags/flags-wire.ts";
import { createFlagsApp, createFlagsEvaluationApp } from "./app.ts";
import { FlagStore } from "./store.ts";
import {
  createFlagsUsageTracker,
  MAX_TRACKED_DEPLOYMENTS,
  MAX_TRACKED_EVALUATIONS,
} from "./usage.ts";

const auth = {
  machineToken: "machine-secret",
  operatorLogins: [],
  trustedProxyAddresses: [],
  publicOrigin: "https://flags.example.test",
};
const machine = { authorization: "Bearer machine-secret" };

/** One store and tracker behind both listeners, as `server.ts` wires them. */
function harness() {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory({ kind: "system", id: "seed" });
  let clock = Date.parse("2026-11-26T10:00:00.000Z");
  const usage = createFlagsUsageTracker(() => new Date(clock));
  const evaluation = createFlagsEvaluationApp({ store, usage });
  const management = createFlagsApp({ store, auth, usage });
  async function read() {
    const response = await management.request("/v1/usage", {
      headers: machine,
    });
    expect(response.status).toBe(200);
    return FlagsUsageResponseSchema.parse(await response.json());
  }
  function advance(seconds: number) {
    clock += seconds * 1000;
  }
  return { evaluation, management, read, advance };
}

async function statusOf(
  pending: Response | Promise<Response>,
): Promise<number> {
  const response = await pending;
  return response.status;
}

function evaluate(
  app: ReturnType<typeof createFlagsEvaluationApp>,
  deployment: string,
  key: string,
) {
  return app.request("/v1/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deployment, key }),
  });
}

test("counts evaluation-port snapshot 200s and 304s per deployment", async () => {
  const { evaluation, read, advance } = harness();
  const path = "/v1/deployments/scout/prod/snapshot";
  const first = await evaluation.request(path);
  expect(first.status).toBe(200);
  const tag = first.headers.get("etag") ?? "";
  advance(90);
  for (let poll = 0; poll < 3; poll += 1) {
    const cached = await evaluation.request(path, {
      headers: { "if-none-match": tag },
    });
    expect(cached.status).toBe(304);
  }
  expect(
    await statusOf(evaluation.request("/v1/deployments/nope/prod/snapshot")),
  ).toBe(404);

  const usage = await read();
  expect(usage.since).toBe("2026-11-26T10:00:00.000Z");
  expect(usage.deployments.find((entry) => entry.id === "scout/prod")).toEqual({
    id: "scout/prod",
    lastFetchedAt: "2026-11-26T10:01:30.000Z",
    fetches200: 1,
    fetches304: 3,
  });
  // Every stored deployment is listed; one nobody fetched reads null.
  expect(usage.deployments.find((entry) => entry.id === "scout/beta")).toEqual({
    id: "scout/beta",
    lastFetchedAt: null,
    fetches200: 0,
    fetches304: 0,
  });
  expect(usage.deployments.some((entry) => entry.id === "nope/prod")).toBe(
    false,
  );
});

test("management-port snapshot and evaluate reads are tooling, not consumers", async () => {
  const { management, read } = harness();
  const snapshot = await management.request(
    "/v1/deployments/scout/prod/snapshot",
  );
  expect(snapshot.status).toBe(200);
  const evaluated = await management.request("/v1/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deployment: "scout/prod", key: "dares_enabled" }),
  });
  expect(evaluated.status).toBe(200);
  const usage = await read();
  expect(
    usage.deployments.find((entry) => entry.id === "scout/prod")?.lastFetchedAt,
  ).toBeNull();
  expect(usage.evaluations).toEqual([]);
});

test("records an evaluation only for a stored deployment's live key", async () => {
  const { evaluation, read, advance } = harness();
  expect(
    await statusOf(evaluate(evaluation, "scout/prod", "dares_enabled")),
  ).toBe(200);
  advance(5);
  expect(
    await statusOf(evaluate(evaluation, "scout/prod", "dares_enabled")),
  ).toBe(200);
  expect(
    await statusOf(evaluate(evaluation, "scout/prod", "no-such-key")),
  ).toBe(404);
  expect(
    await statusOf(evaluate(evaluation, "nope/prod", "dares_enabled")),
  ).toBe(404);
  const usage = await read();
  expect(usage.evaluations).toEqual([
    {
      deployment: "scout/prod",
      key: "dares_enabled",
      lastEvaluatedAt: "2026-11-26T10:00:05.000Z",
      count: 2,
    },
  ]);
});

test("the tracker stops adding entries at its caps and keeps counting known ones", () => {
  const tracker = createFlagsUsageTracker();
  for (let index = 0; index <= MAX_TRACKED_DEPLOYMENTS; index += 1) {
    tracker.recordFetch(`catalog-${String(index)}/prod`, 200);
  }
  expect(
    tracker.fetches(`catalog-${String(MAX_TRACKED_DEPLOYMENTS)}/prod`),
  ).toBeUndefined();
  tracker.recordFetch("catalog-0/prod", 304);
  expect(tracker.fetches("catalog-0/prod")).toMatchObject({
    fetches200: 1,
    fetches304: 1,
  });

  for (let index = 0; index <= MAX_TRACKED_EVALUATIONS; index += 1) {
    tracker.recordEvaluation("scout/prod", `key-${String(index)}`);
  }
  tracker.recordEvaluation("scout/prod", "key-0");
  const evaluations = tracker.evaluations();
  expect(evaluations).toHaveLength(MAX_TRACKED_EVALUATIONS);
  expect(evaluations.find((entry) => entry.key === "key-0")?.count).toBe(2);
});

test("GET /v1/usage requires management auth, is not on the evaluation port, and embeds the static index", async () => {
  const { evaluation, management, read } = harness();
  expect(await statusOf(management.request("/v1/usage"))).toBe(401);
  expect(await statusOf(evaluation.request("/v1/usage"))).toBe(404);
  const usage = await read();
  expect(usage.static.version).toBe(1);
  expect(usage.static.flags["delivery-lease-seconds"]).toContainEqual({
    package: "@shepherdjerred/delivery",
    file: "packages/delivery/src/infrastructure/config.ts",
    kind: "config-flag-name",
    count: 1,
  });
  expect(usage.static.unreferenced).toContain("alert-dashboard-email-from");
  expect(usage.static.flags["alert-dashboard-email-from"]).toBeUndefined();
});
