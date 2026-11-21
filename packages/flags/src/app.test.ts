import { expect, test } from "vitest";
import { z } from "zod";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { createFlagsApp } from "./app.ts";
import { FlagValueSchema } from "./schema.ts";
import { FlagStore } from "./store.ts";

const auth = {
  machineToken: "machine-secret",
  operatorLogins: ["operator@example.com"],
  trustedProxyAddresses: ["100.64.0.1"],
  publicOrigin: "https://flags.example.test",
};

const machineHeaders = { authorization: "Bearer machine-secret" };
const jsonHeaders = {
  authorization: "Bearer machine-secret",
  "content-type": "application/json",
};

function harness(peer: string | null = null) {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory();
  const app = createFlagsApp({
    store,
    auth,
    peerAddress: () => peer,
  });
  return { app, store };
}

const added: FlagValue = {
  type: "boolean",
  key: "flags-test-added",
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

test("health and an unknown path", async () => {
  const { app } = harness();
  const health = await app.request("/healthz");
  expect(health.status).toBe(200);
  expect(await health.text()).toBe("ok");
  const missing = await app.request("/");
  expect(missing.status).toBe(404);
});

test("seeds deployments once and leaves an existing flag alone", () => {
  const store = FlagStore.open(":memory:");
  const first = store.seedFromInventory();
  expect(first.seeded.length).toBeGreaterThan(0);
  const before = store.flag("scout/prod", "dares_enabled");
  if (before?.flag.type !== "boolean") throw new Error("dares_enabled missing");
  const changed: FlagValue = { ...before.flag, default: true };
  const applied = store.apply("scout/prod", before.revision, [changed]);
  expect(applied.ok).toBe(true);
  const second = store.seedFromInventory();
  expect(second.seeded).toEqual([]);
  expect(store.flag("scout/prod", "dares_enabled")?.flag).toMatchObject({
    default: true,
  });
  const unread = store
    .unreadDocuments()
    .map((document) => `${document.catalog}/${document.fliptEnvironment}`);
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
  expect(body.created).toEqual(["flags-test-added"]);
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
          key: "flags-test-second",
          default: false,
          rollouts: [],
        },
      ],
    }),
  });
  expect(response.status).toBe(409);
  const body = Conflict.parse(await response.json());
  expect(body.revision).toBe(before.revision);
  expect(body.flags.map((flag) => flag.key)).not.toContain("flags-test-added");
  expect(store.flag("scout/prod", "flags-test-second")).toBeUndefined();
  expect(store.document("scout/prod")?.revision).toBe(before.revision);
});

test("retire refuses a missing key and deletes when the revision matches", async () => {
  const { app, store } = harness();
  const created = store.createMissing("scout/prod", [added]);
  if (!created.ok) throw new Error("create failed");
  const refused = await app.request("/v1/deployments/scout/prod/retire", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      expectedRevision: created.revision,
      keys: ["flags-test-added", "flags-test-missing"],
    }),
  });
  expect(refused.status).toBe(409);
  expect(store.flag("scout/prod", "flags-test-added")).toBeDefined();
  const retired = await app.request("/v1/deployments/scout/prod/retire", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      expectedRevision: created.revision,
      keys: ["flags-test-added"],
    }),
  });
  expect(retired.status).toBe(200);
  expect(store.flag("scout/prod", "flags-test-added")).toBeUndefined();
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
  const { app: trusted } = harness("100.64.0.1");
  const browser = await trusted.request("/v1/deployments", {
    headers: {
      origin: "https://flags.example.test",
      "tailscale-user-login": "operator@example.com",
    },
  });
  expect(browser.status).toBe(200);
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
  store.apply("scout/prod", current.revision, [
    { ...current.flag, default: true },
  ]);
  const driftedResponse = await app.request("/v1/diff", {
    headers: machineHeaders,
  });
  const drifted = Diff.parse(await driftedResponse.json());
  const scout = drifted.deployments.find(
    (deployment) => deployment.id === "scout/prod",
  );
  expect(scout?.drift.map((flag) => flag.key)).toEqual(["dares_enabled"]);
});
