import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { createFlagsApp, createFlagsEvaluationApp } from "./app.ts";
import { authFromEnv } from "./auth.ts";
import { createFlagsMetrics } from "./metrics.ts";
import { FlagValueSchema } from "./schema.ts";
import { FlagStore } from "./store.ts";

const auth = {
  machineToken: "machine-secret",
  operatorLogins: ["operator@example.com"],
  trustedProxyAddresses: ["100.64.0.1"],
  publicOrigin: "https://flags.example.test",
};

const testActor = { kind: "machine", id: "test" } as const;
const machineHeaders = { authorization: "Bearer machine-secret" };
const jsonHeaders = {
  authorization: "Bearer machine-secret",
  "content-type": "application/json",
};

function harness(peer: string | null = null) {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory({ kind: "system", id: "seed" });
  const app = createFlagsApp({
    store,
    auth,
    peerAddress: () => peer,
  });
  return { app, store };
}

const added: FlagValue = {
  type: "boolean",
  key: "delivery-writes-enabled",
  default: true,
  rollouts: [],
};

const FlagRead = z.object({
  revision: z.number(),
  flag: FlagValueSchema,
});

const Created = z.object({
  created: z.array(z.string()),
  revision: z.number(),
});

const Conflict = z.object({
  revision: z.number(),
  flags: z.array(FlagValueSchema),
});

const Diff = z.object({
  deployments: z.array(
    z.object({
      id: z.string(),
      missing: z.array(z.unknown()),
      extra: z.array(z.unknown()),
      drift: z.array(z.object({ key: z.string() })),
    }),
  ),
});

test("health, metrics, and an unknown path", async () => {
  const { app, store } = harness();
  const health = await app.request("/healthz");
  expect(health.status).toBe(200);
  expect(await health.text()).toBe("ok");
  const initialMetrics = await app.request("/metrics");
  expect(initialMetrics.status).toBe(200);
  expect(initialMetrics.headers.get("content-type")).toContain(
    "text/plain; version=0.0.4",
  );
  const initialBody = await initialMetrics.text();
  expect(initialBody).toContain("# TYPE flags_deployments gauge");
  expect(initialBody).toContain(
    'flags_deployment_revision{deployment="scout/prod"} 1',
  );
  expect(initialBody).toMatch(
    /flags_deployment_flags\{deployment="scout\/prod"\} [1-9]\d*/u,
  );
  const current = store.flag("scout/prod", "dares_enabled");
  if (current === undefined) throw new Error("dares_enabled missing");
  expect(
    store.apply("scout/prod", current.revision, [current.flag], testActor).ok,
  ).toBe(true);
  const updatedMetrics = await app.request("/metrics");
  expect(await updatedMetrics.text()).toContain(
    'flags_deployment_revision{deployment="scout/prod"} 2',
  );
  const missing = await app.request("/");
  expect(missing.status).toBe(404);
});

test("seeds deployments once and leaves an existing flag alone", () => {
  const store = FlagStore.open(":memory:");
  const first = store.seedFromInventory({ kind: "system", id: "seed" });
  expect(first.seeded.length).toBeGreaterThan(0);
  const before = store.flag("scout/prod", "dares_enabled");
  if (before?.flag.type !== "boolean") throw new Error("dares_enabled missing");
  const changed: FlagValue = { ...before.flag, default: true };
  const applied = store.apply(
    "scout/prod",
    before.revision,
    [changed],
    testActor,
  );
  expect(applied.ok).toBe(true);
  const second = store.seedFromInventory({ kind: "system", id: "seed" });
  expect(second.seeded).toEqual([]);
  expect(store.flag("scout/prod", "dares_enabled")?.flag).toMatchObject({
    default: true,
  });
  const unread = store
    .unreadDocuments()
    .map((document) => `${document.catalog}/${document.stage}`);
  expect(unread).toContain("delivery/beta");
  expect(unread).not.toContain("scout/prod");
});

test("create-missing does not clobber", async () => {
  const { app } = harness();
  const before = await app.request(
    "/v1/deployments/scout/prod/flags/dares_enabled",
    { headers: machineHeaders },
  );
  const existing = FlagRead.parse(await before.json());
  if (existing.flag.type !== "boolean") throw new Error("expected a boolean");
  const response = await app.request(
    "/v1/deployments/scout/prod/create-missing",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        flags: [{ ...existing.flag, default: true }, added],
      }),
    },
  );
  expect(response.status).toBe(200);
  const body = Created.parse(await response.json());
  expect(body.created).toEqual(["delivery-writes-enabled"]);
  expect(body.revision).toBe(existing.revision + 1);
  const after = await app.request(
    "/v1/deployments/scout/prod/flags/dares_enabled",
    { headers: machineHeaders },
  );
  expect(FlagRead.parse(await after.json()).flag).toMatchObject({
    default: false,
  });
});

test("apply conflict writes nothing", async () => {
  const { app, store } = harness();
  const before = store.document("scout/prod");
  if (before === undefined) throw new Error("scout/prod missing");
  const response = await app.request("/v1/deployments/scout/prod/apply", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      expectedRevision: before.revision - 1,
      flags: [
        added,
        {
          type: "boolean",
          key: "tracker-writes-enabled",
          default: false,
          rollouts: [],
        },
      ],
    }),
  });
  expect(response.status).toBe(409);
  const body = Conflict.parse(await response.json());
  expect(body.revision).toBe(before.revision);
  expect(body.flags.map((flag) => flag.key)).not.toContain(
    "delivery-writes-enabled",
  );
  expect(store.flag("scout/prod", "tracker-writes-enabled")).toBeUndefined();
  expect(store.document("scout/prod")?.revision).toBe(before.revision);
});

test("retire refuses a missing key and deletes when the revision matches", async () => {
  const { app, store } = harness();
  const created = store.createMissing("scout/prod", [added], testActor);
  if (!created.ok) throw new Error("create failed");
  const refused = await app.request("/v1/deployments/scout/prod/retire", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      expectedRevision: created.revision,
      keys: ["delivery-writes-enabled", "tracker-forum-enabled"],
    }),
  });
  expect(refused.status).toBe(409);
  expect(store.flag("scout/prod", "delivery-writes-enabled")).toBeDefined();
  const retired = await app.request("/v1/deployments/scout/prod/retire", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      expectedRevision: created.revision,
      keys: ["delivery-writes-enabled"],
    }),
  });
  expect(retired.status).toBe(200);
  expect(store.flag("scout/prod", "delivery-writes-enabled")).toBeUndefined();
});

test("snapshot is credentialless and answers 304", async () => {
  const { app } = harness();
  const refused = await app.request("/v1/deployments/scout/prod/snapshot", {
    headers: { authorization: "Bearer machine-secret" },
  });
  expect(refused.status).toBe(401);
  const first = await app.request("/v1/deployments/scout/prod/snapshot");
  expect(first.status).toBe(200);
  const tag = first.headers.get("etag");
  expect(tag).toBe('"1"');
  const cached = await app.request("/v1/deployments/scout/prod/snapshot", {
    headers: { "if-none-match": tag ?? "" },
  });
  expect(cached.status).toBe(304);
});

test("boolean evaluation distinguishes false from a missing flag", async () => {
  const { app } = harness();
  const off = await app.request("/v1/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deployment: "scout/prod",
      key: "dares_enabled",
      context: { server: "anyone" },
    }),
  });
  expect(off.status).toBe(200);
  expect(await off.json()).toEqual({ enabled: false });
  const missing = await app.request("/v1/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deployment: "scout/prod", key: "not-a-flag" }),
  });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "FLAG_NOT_FOUND" });
  const variant = await app.request("/v1/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deployment: "scout/prod",
      key: "scout-explore-model",
    }),
  });
  expect(variant.status).toBe(400);
  const credential = await app.request("/v1/evaluate", {
    method: "POST",
    headers: {
      authorization: "Bearer machine-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ deployment: "scout/prod", key: "dares_enabled" }),
  });
  expect(credential.status).toBe(401);
});

test("management requires an operator or the machine token", async () => {
  const { app } = harness();
  const anonymous = await app.request("/v1/deployments");
  expect(anonymous.status).toBe(401);
  const spoofed = await app.request("/v1/deployments", {
    headers: { "tailscale-user-login": "operator@example.com" },
  });
  expect(spoofed.status).toBe(401);
  const machineList = await app.request("/v1/deployments", {
    headers: machineHeaders,
  });
  expect(machineList.status).toBe(200);
  const { app: trusted, store } = harness("100.64.0.1");
  const browser = await trusted.request("/v1/deployments", {
    headers: {
      origin: "https://flags.example.test",
      "tailscale-user-login": "operator@example.com",
    },
  });
  expect(browser.status).toBe(200);
  const current = store.flag("scout/prod", "dares_enabled");
  if (current?.flag.type !== "boolean")
    throw new Error("dares_enabled missing");
  const document = store.document("scout/prod");
  if (document === undefined) throw new Error("scout/prod missing");
  const operatorWrite = {
    "tailscale-user-login": "operator@example.com",
    "content-type": "application/json",
  };
  const bareCli = await trusted.request("/v1/deployments/scout/prod/apply", {
    method: "POST",
    headers: operatorWrite,
    body: JSON.stringify({
      expectedRevision: document.revision,
      flags: [{ ...current.flag, default: true }],
    }),
  });
  expect(bareCli.status).toBe(403);
  expect(store.flag("scout/prod", "dares_enabled")?.flag).toMatchObject({
    default: false,
  });
  const sameOrigin = await trusted.request("/v1/deployments/scout/prod/apply", {
    method: "POST",
    headers: { ...operatorWrite, origin: "https://flags.example.test" },
    body: JSON.stringify({
      expectedRevision: document.revision,
      flags: [{ ...current.flag, default: true }],
    }),
  });
  expect(sameOrigin.status).toBe(200);
  expect(store.flag("scout/prod", "dares_enabled")?.flag).toMatchObject({
    default: true,
  });
  const crossSite = await trusted.request("/v1/deployments/scout/prod/apply", {
    method: "POST",
    headers: {
      origin: "https://evil.example.test",
      "tailscale-user-login": "operator@example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({ expectedRevision: 1, flags: [added] }),
  });
  expect(crossSite.status).toBe(403);
});

test("diff is empty after the seed and names a drifted flag", async () => {
  const { app, store } = harness();
  const cleanResponse = await app.request("/v1/diff", {
    headers: machineHeaders,
  });
  expect(cleanResponse.status).toBe(200);
  const clean = Diff.parse(await cleanResponse.json());
  for (const deployment of clean.deployments) {
    expect(deployment.missing).toEqual([]);
    expect(deployment.extra).toEqual([]);
    expect(deployment.drift).toEqual([]);
  }
  const current = store.flag("scout/prod", "dares_enabled");
  if (current?.flag.type !== "boolean")
    throw new Error("dares_enabled missing");
  store.apply(
    "scout/prod",
    current.revision,
    [{ ...current.flag, default: true }],
    testActor,
  );
  const driftedResponse = await app.request("/v1/diff", {
    headers: machineHeaders,
  });
  const drifted = Diff.parse(await driftedResponse.json());
  const scout = drifted.deployments.find(
    (deployment) => deployment.id === "scout/prod",
  );
  expect(scout?.drift.map((flag) => flag.key)).toEqual(["dares_enabled"]);
});

test("trusted proxy CIDR matches pod subnet peers and rejects out-of-subnet peers", async () => {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory({ kind: "system", id: "seed" });
  let peer: string | null = null;
  const cidrAuth = authFromEnv({
    FLAGS_OPERATOR_LOGINS: "operator@example.com",
    FLAGS_TRUSTED_PROXIES: "10.244.0.0/16",
    FLAGS_PUBLIC_ORIGIN: "https://flags.example.test",
  });
  const app = createFlagsApp({
    store,
    auth: cidrAuth,
    peerAddress: () => peer,
  });
  const operatorHeaders = {
    origin: "https://flags.example.test",
    "tailscale-user-login": "operator@example.com",
  };

  peer = "10.244.0.29";
  const ipv4Match = await app.request("/v1/deployments", {
    headers: operatorHeaders,
  });
  expect(ipv4Match.status).toBe(200);

  peer = "::ffff:10.244.0.29";
  const mappedMatch = await app.request("/v1/deployments", {
    headers: operatorHeaders,
  });
  expect(mappedMatch.status).toBe(200);

  peer = "10.245.0.1";
  const outOfSubnet = await app.request("/v1/deployments", {
    headers: operatorHeaders,
  });
  expect(outOfSubnet.status).toBe(401);

  expect(() => authFromEnv({ FLAGS_TRUSTED_PROXIES: "10.244.0.0/99" })).toThrow(
    /Invalid FLAGS_TRUSTED_PROXIES entry/,
  );
  expect(() => authFromEnv({ FLAGS_TRUSTED_PROXIES: "not-an-ip" })).toThrow(
    /Invalid FLAGS_TRUSTED_PROXIES entry/,
  );
});

test("evaluation app serves health, snapshot, and evaluate without management routes", async () => {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory({ kind: "system", id: "seed" });
  const app = createFlagsEvaluationApp({ store });

  const health = await app.request("/healthz");
  expect(health.status).toBe(200);
  expect(await health.text()).toBe("ok");

  const snapshot = await app.request("/v1/deployments/scout/prod/snapshot");
  expect(snapshot.status).toBe(200);
  const tag = snapshot.headers.get("etag");
  expect(tag).toBe('"1"');
  const cached = await app.request("/v1/deployments/scout/prod/snapshot", {
    headers: { "if-none-match": tag ?? "" },
  });
  expect(cached.status).toBe(304);

  const evaluated = await app.request("/v1/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deployment: "scout/prod", key: "dares_enabled" }),
  });
  expect(evaluated.status).toBe(200);
  expect(await evaluated.json()).toEqual({ enabled: false });

  const withCredentials = await app.request("/v1/deployments", {
    headers: { authorization: "Bearer machine-secret" },
  });
  expect(withCredentials.status).toBe(401);
  expect(await withCredentials.json()).toEqual({
    error: "evaluation does not accept credentials",
  });

  const operatorHeaderIgnored = await app.request("/v1/deployments", {
    headers: { "tailscale-user-login": "operator@example.com" },
  });
  expect(operatorHeaderIgnored.status).toBe(404);

  const metricsOnEval = await app.request("/metrics");
  expect(metricsOnEval.status).toBe(404);
});

test("metrics serves Prometheus text before the SPA client fallback and shares counters across surfaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "flags-metrics-client-"));
  try {
    await Bun.write(
      path.join(root, "index.html"),
      "<!doctype html><title>Flags</title>",
    );
    await mkdir(path.join(root, "assets"));
    await Bun.write(path.join(root, "assets", "bundle.js"), "export {};");

    const store = FlagStore.open(":memory:");
    store.seedFromInventory({ kind: "system", id: "seed" });
    const metrics = createFlagsMetrics();
    const managementApp = createFlagsApp({
      store,
      auth,
      peerAddress: () => null,
      clientRoot: root,
      metrics,
    });
    const evaluationApp = createFlagsEvaluationApp({ store, metrics });

    const page = await managementApp.request("/scout/prod");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Flags");

    const asset = await managementApp.request("/assets/bundle.js");
    expect(asset.status).toBe(200);

    const health = await managementApp.request("/healthz");
    expect(health.status).toBe(200);

    const unauthDeployments = await managementApp.request("/v1/deployments");
    expect(unauthDeployments.status).toBe(401);

    const listDeployments = await managementApp.request("/v1/deployments", {
      headers: machineHeaders,
    });
    expect(listDeployments.status).toBe(200);

    const malformed = await managementApp.request("/v1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(malformed.status).toBe(400);

    const unboundedUnknown = await managementApp.request(
      "/v1/unknown/secret-token-12345",
      { headers: machineHeaders },
    );
    expect(unboundedUnknown.status).toBe(200);

    const evalSnapshot = await evaluationApp.request(
      "/v1/deployments/scout/prod/snapshot",
    );
    expect(evalSnapshot.status).toBe(200);
    const evalCached = await evaluationApp.request(
      "/v1/deployments/scout/prod/snapshot",
      {
        headers: { "if-none-match": evalSnapshot.headers.get("etag") ?? "" },
      },
    );
    expect(evalCached.status).toBe(304);

    const evalFlag = await evaluationApp.request("/v1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deployment: "scout/prod",
        key: "dares_enabled",
      }),
    });
    expect(evalFlag.status).toBe(200);

    const evalUnknown = await evaluationApp.request(
      "/unbounded-eval-path-99999",
    );
    expect(evalUnknown.status).toBe(404);

    const firstScrape = await managementApp.request("/metrics");
    expect(firstScrape.status).toBe(200);
    expect(firstScrape.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(firstScrape.headers.get("cache-control")).toBe("no-store");
    const body = await firstScrape.text();
    expect(body).not.toContain("<!doctype html>");
    expect(body).not.toContain("secret-token-12345");
    expect(body).not.toContain("unbounded-eval-path-99999");
    expect(body.endsWith("\n")).toBe(true);

    const summaries = store.list();
    const expectedDefined = summaries.reduce(
      (sum, item) => sum + item.flagCount,
      0,
    );
    expect(body).toContain(`flags_deployments ${String(summaries.length)}`);
    expect(body).toContain(`flags_defined_total ${String(expectedDefined)}`);
    const scoutSummary = summaries.find((item) => item.id === "scout/prod");
    expect(scoutSummary).toBeDefined();
    expect(body).toContain(
      `flags_deployment_flags{deployment="scout/prod"} ${String(scoutSummary?.flagCount)}`,
    );
    expect(body).toContain(
      `flags_deployment_revision{deployment="scout/prod"} 1`,
    );

    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="client",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="assets",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="healthz",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="deployments",status="401"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="deployments",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="evaluate",status="400"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="management",route="other",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="evaluation",route="snapshot",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="evaluation",route="snapshot",status="304"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="evaluation",route="evaluate",status="200"} 1',
    );
    expect(body).toContain(
      'flags_http_requests_total{surface="evaluation",route="other",status="404"} 1',
    );

    const created = store.createMissing("scout/prod", [added], testActor);
    expect(created.ok).toBe(true);
    const secondScrape = await managementApp.request("/metrics");
    const secondBody = await secondScrape.text();
    expect(secondBody).toContain(
      `flags_defined_total ${String(expectedDefined + 1)}`,
    );
    expect(secondBody).toContain(
      `flags_deployment_revision{deployment="scout/prod"} 2`,
    );
    expect(secondBody).toContain(
      'flags_http_requests_total{surface="management",route="metrics",status="200"} 1',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
