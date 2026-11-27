import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { flagDeployments } from "@shepherdjerred/feature-flags/deployments.ts";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { retiredKeysForDeployment } from "@shepherdjerred/feature-flags/flags-reconcile.ts";
import {
  FlagsArchiveResponseSchema,
  FlagsHistoryResponseSchema,
  FlagsMetadataResponseSchema,
} from "@shepherdjerred/feature-flags/flags-wire.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import { createFlagsApp, createFlagsEvaluationApp } from "./app.ts";
import legacyDates from "./legacy-flag-dates.json" with { type: "json" };
import { createFlagsMetrics } from "./metrics.ts";
import { FlagStore } from "./store.ts";

const auth = {
  machineToken: "machine-secret",
  operatorLogins: ["operator@example.com"],
  trustedProxyAddresses: ["100.64.0.1"],
  publicOrigin: "https://flags.example.test",
};
const machineHeaders = { authorization: "Bearer machine-secret" };
const operatorHeaders = {
  origin: "https://flags.example.test",
  "tailscale-user-login": "operator@example.com",
};

const added: FlagValue = {
  type: "boolean",
  key: "delivery-writes-enabled",
  default: true,
  rollouts: [],
};
/** Retired from scout/prod by declaration but still stored in the old DB. */
const lingeringRetiredKey = "ai_reviews_enabled";
const migratedAt = new Date("2026-11-20T12:00:00.000Z");

const scoutProd = flagDeployments.find((d) => d.id === "scout/prod");
if (scoutProd === undefined) throw new Error("scout/prod missing");
const projected = projectDeploymentFlags(scoutProd);

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "flags-audit-routes-"));
  dbPath = path.join(dir, "flags.sqlite");
  // A pre-audit database: scout/prod as an older image stored it.
  const db = new Database(dbPath);
  db.run(
    "CREATE TABLE deployment (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
  );
  db.run(`CREATE TABLE flag (
    deployment_id TEXT NOT NULL REFERENCES deployment(id),
    key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (deployment_id, key))`);
  db.query(
    "INSERT INTO deployment (id, revision) VALUES ('scout/prod', 4)",
  ).run();
  const insert = db.query(
    "INSERT INTO flag (deployment_id, key, body) VALUES ('scout/prod', ?, ?)",
  );
  for (const flag of [
    ...projected,
    { type: "boolean", key: lingeringRetiredKey, default: false, rollouts: [] },
  ]) {
    insert.run(flag.key, JSON.stringify(flag));
  }
  db.close();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function harness(peer: string | null = null) {
  let tick = migratedAt.getTime();
  const store = FlagStore.open(dbPath, {
    now: () => {
      const now = new Date(tick);
      tick += 1000;
      return now;
    },
  });
  store.seedFromInventory({ kind: "system", id: "seed" });
  const metrics = createFlagsMetrics();
  const app = createFlagsApp({ store, auth, peerAddress: () => peer, metrics });
  return { app, store, metrics };
}

function revision(store: FlagStore): number {
  const document = store.document("scout/prod");
  if (document === undefined) throw new Error("scout/prod missing");
  return document.revision;
}

async function history(app: ReturnType<typeof harness>["app"], key: string) {
  const response = await app.request(
    `/v1/deployments/scout/prod/flags/${key}/history`,
    { headers: machineHeaders },
  );
  expect(response.status).toBe(200);
  return FlagsHistoryResponseSchema.parse(await response.json());
}

function legacyKey(onOrBefore: boolean): string {
  const dates: Readonly<Record<string, { readonly onOrBefore: boolean }>> =
    legacyDates.dates;
  const key = projected
    .map((flag) => flag.key)
    .find((candidate) => dates[candidate]?.onOrBefore === onOrBefore);
  if (key === undefined)
    throw new Error(`no scout/prod key ${String(onOrBefore)}`);
  return key;
}

test("operator apply, history, metadata bases, machine retire and archive", async () => {
  const { app, store, metrics } = harness("100.64.0.1");
  try {
    const applied = await app.request("/v1/deployments/scout/prod/apply", {
      method: "POST",
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "x-flags-actor": "spoofed-label",
      },
      body: JSON.stringify({
        expectedRevision: revision(store),
        flags: [added],
      }),
    });
    expect(applied.status).toBe(200);

    const created = await history(app, added.key);
    expect(created.auditStartedAt).toBe(migratedAt.toISOString());
    expect(created.nextBefore).toBeNull();
    expect(created.entries).toMatchObject([
      {
        action: "create",
        actor: { kind: "human", id: "operator@example.com" },
        revisionAfter: 5,
        before: null,
        after: added,
      },
    ]);

    const metadataResponse = await app.request(
      "/v1/deployments/scout/prod/metadata",
      { headers: machineHeaders },
    );
    expect(metadataResponse.status).toBe(200);
    const metadata = FlagsMetadataResponseSchema.parse(
      await metadataResponse.json(),
    );
    expect(metadata.deployment).toBe("scout/prod");
    const byKey = new Map(metadata.flags.map((flag) => [flag.key, flag]));
    expect(byKey.get(added.key)).toMatchObject({
      namespace: "delivery",
      declared: false,
      createdAtBasis: "recorded",
      createdAt: created.entries[0]?.at,
      lastChangedBy: { kind: "human", id: "operator@example.com" },
    });
    const firstDeclared = legacyKey(false);
    expect(byKey.get(firstDeclared)).toMatchObject({
      namespace: "scout",
      declared: true,
      createdAtBasis: "first-declared",
      lastChangedAt: null,
      lastChangedBy: null,
    });
    expect(byKey.get(legacyKey(true))).toMatchObject({
      createdAtBasis: "on-or-before",
      createdAt: "2026-08-26T01:11:52.000Z",
    });
    const lingering = byKey.get(lingeringRetiredKey);
    expect(lingering).toEqual({
      key: lingeringRetiredKey,
      declared: false,
      createdAt: null,
      createdAtBasis: "unknown",
      lastChangedAt: null,
      lastChangedBy: null,
    });

    const retired = await app.request("/v1/deployments/scout/prod/retire", {
      method: "POST",
      headers: {
        ...machineHeaders,
        "content-type": "application/json",
        "x-flags-actor": "check-flag-inventory",
      },
      body: JSON.stringify({
        expectedRevision: revision(store),
        keys: [added.key],
      }),
    });
    expect(retired.status).toBe(200);

    const archiveResponse = await app.request("/v1/archive", {
      headers: machineHeaders,
    });
    expect(archiveResponse.status).toBe(200);
    const archive = FlagsArchiveResponseSchema.parse(
      await archiveResponse.json(),
    );
    const scout = archive.deployments.find((d) => d.id === "scout/prod");
    expect(scout?.flags.find((flag) => flag.key === added.key)).toEqual({
      key: added.key,
      retiredAt: expect.any(String),
      retiredBy: { kind: "machine", id: "check-flag-inventory" },
      final: added,
      revision: 6,
      basis: "recorded",
    });
    const declaredRetired = retiredKeysForDeployment(scoutProd).filter(
      (key) => key !== lingeringRetiredKey,
    );
    expect(declaredRetired.length).toBeGreaterThan(0);
    for (const key of declaredRetired) {
      expect(scout?.flags.find((flag) => flag.key === key)).toEqual({
        key,
        retiredAt: null,
        retiredBy: null,
        final: null,
        revision: null,
        basis: "declared-retired",
      });
    }
    expect(scout?.flags.map((flag) => flag.key)).not.toContain(
      lingeringRetiredKey,
    );

    const rendered = metrics.render(store);
    for (const route of ["history", "metadata", "archive"]) {
      expect(rendered).toContain(
        `surface="management",route="${route}",status="200"`,
      );
    }
  } finally {
    store.close();
  }
});

test("machine actor labels are advisory and sanitised", async () => {
  const { app, store } = harness();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {
    // Captured for assertions instead of printed.
  });
  try {
    for (const label of [undefined, "Not A Label!", "x".repeat(65)]) {
      const response = await app.request(
        "/v1/deployments/scout/prod/create-missing",
        {
          method: "POST",
          headers: {
            ...machineHeaders,
            "content-type": "application/json",
            ...(label === undefined ? {} : { "x-flags-actor": label }),
          },
          body: JSON.stringify({ flags: [added] }),
        },
      );
      expect(response.status).toBe(200);
      const retired = store.retire("scout/prod", revision(store), [added.key], {
        kind: "system",
        id: "seed",
      });
      expect(retired.ok).toBe(true);
    }
    const page = await history(app, added.key);
    const entries = page.entries.filter((entry) => entry.action === "create");
    expect(entries.map((entry) => entry.actor)).toEqual(
      Array.from({ length: 3 }, () => ({ kind: "machine", id: "unknown" })),
    );
    const warnings = warn.mock.calls.map(([line]) => String(line));
    expect(
      warnings.filter((line) => line.includes("without a valid actor label")),
    ).toHaveLength(3);
    expect(warnings.join("\n")).not.toContain("Not A Label!");
  } finally {
    store.close();
  }
});

test("history validates its page query and 404s an unknown deployment", async () => {
  const { app, store } = harness();
  try {
    const tooMany = await app.request(
      "/v1/deployments/scout/prod/flags/dares_enabled/history?limit=101",
      { headers: machineHeaders },
    );
    expect(tooMany.status).toBe(400);
    const unknown = await app.request(
      "/v1/deployments/nope/prod/flags/dares_enabled/history",
      { headers: machineHeaders },
    );
    expect(unknown.status).toBe(404);
    const metadata = await app.request("/v1/deployments/nope/prod/metadata", {
      headers: machineHeaders,
    });
    expect(metadata.status).toBe(404);
    const anonymous = await app.request("/v1/archive");
    expect(anonymous.status).toBe(401);
  } finally {
    store.close();
  }
});

test("the evaluation app does not mount the audit views", async () => {
  const { store } = harness();
  try {
    const evaluation = createFlagsEvaluationApp({ store });
    for (const route of [
      "/v1/archive",
      "/v1/deployments/scout/prod/metadata",
      "/v1/deployments/scout/prod/flags/dares_enabled/history",
    ]) {
      const response = await evaluation.request(route);
      expect(response.status).toBe(404);
    }
  } finally {
    store.close();
  }
});
