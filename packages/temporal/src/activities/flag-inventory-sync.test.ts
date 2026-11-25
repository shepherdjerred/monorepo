import { Registry } from "prom-client";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import { createFlagInventoryMetrics } from "#observability/metrics-flags.ts";
import { flagDeployments } from "@shepherdjerred/feature-flags/deployments.ts";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  diffProjectedDeploymentFlags,
  FlagsValueSchema,
  type FlagsHttpFetcher,
} from "@shepherdjerred/feature-flags/flags-drift.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import {
  checkFlagInventory,
  reconcileFlagsInventory,
} from "./flag-inventory-sync.ts";

const MutationBodySchema = z.object({
  keys: z.array(z.string()).optional(),
  flags: z.array(FlagsValueSchema).optional(),
});

type StoredDoc = { revision: number; flags: FlagValue[] };

function parseRequestUrl(input: string | Request | URL): URL {
  if (typeof input === "string") return new URL(input);
  return input instanceof URL ? input : new URL(input.url);
}

function buildDiffResponse(store: ReadonlyMap<string, StoredDoc>): Response {
  const deployments = flagDeployments.map((deployment) => {
    const doc = store.get(deployment.id);
    if (doc === undefined) throw new Error(`missing ${deployment.id}`);
    return diffProjectedDeploymentFlags(deployment, doc);
  });
  return Response.json({ deployments });
}

function applyCreateMissing(doc: StoredDoc, incoming: readonly FlagValue[]) {
  const present = new Set(doc.flags.map((f) => f.key));
  const created: string[] = [];
  for (const flag of incoming) {
    if (present.has(flag.key)) continue;
    doc.flags.push(flag);
    created.push(flag.key);
  }
  if (created.length > 0) doc.revision += 1;
  return Response.json({ revision: doc.revision, created });
}

function handleDeploymentRequest(
  store: ReadonlyMap<string, StoredDoc>,
  pathname: string,
  method: string,
  rawBody: string | undefined,
): Response {
  const match =
    /^\/v1\/deployments\/([^/]+)\/([^/]+)(?:\/(retire|create-missing))?$/u.exec(
      pathname,
    );
  if (match === null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const id = `${decodeURIComponent(match[1] ?? "")}/${decodeURIComponent(match[2] ?? "")}`;
  const doc = store.get(id);
  if (doc === undefined) {
    return Response.json({ error: "unknown deployment" }, { status: 404 });
  }
  const action = match[3];
  if (method === "GET" && action === undefined) {
    return Response.json({ id, revision: doc.revision, flags: doc.flags });
  }
  if (method !== "POST") {
    return Response.json({ error: "unsupported" }, { status: 405 });
  }
  const body =
    rawBody === undefined ? {} : MutationBodySchema.parse(JSON.parse(rawBody));
  if (action === "retire") {
    const keys = body.keys ?? [];
    doc.flags = doc.flags.filter((f) => !keys.includes(f.key));
    doc.revision += 1;
    return Response.json({ revision: doc.revision });
  }
  return applyCreateMissing(doc, body.flags ?? []);
}

function buildFakeFlagsService() {
  const store = new Map<string, StoredDoc>(
    flagDeployments.map((deployment) => [
      deployment.id,
      { revision: 1, flags: projectDeploymentFlags(deployment) },
    ]),
  );
  store.get("scout/beta")?.flags.push({
    type: "boolean",
    key: "ai_reviews_enabled",
    default: false,
    rollouts: [],
  });
  const golinkDoc = store.get("golink/prod");
  if (golinkDoc !== undefined) golinkDoc.flags = golinkDoc.flags.slice(1);
  const scoutProdDoc = store.get("scout/prod");
  if (scoutProdDoc !== undefined) {
    scoutProdDoc.flags = [
      ...scoutProdDoc.flags.map((flag) =>
        flag.key === "dares_enabled" && flag.type === "boolean"
          ? { ...flag, default: true }
          : flag,
      ),
      {
        type: "boolean",
        key: "manual-extra-flag",
        default: true,
        rollouts: [],
      },
    ];
  }

  const authHeaders: (string | null)[] = [];
  const upstreamFetch: FlagsHttpFetcher = (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = parseRequestUrl(input);
    const method = init?.method ?? request?.method ?? "GET";
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    authHeaders.push(headers.get("authorization"));

    if (method === "GET" && url.pathname === "/v1/diff") {
      return Promise.resolve(buildDiffResponse(store));
    }
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    return Promise.resolve(
      handleDeploymentRequest(store, url.pathname, method, rawBody),
    );
  };

  return { store, authHeaders, upstreamFetch };
}

describe("Flags inventory reconciler activity", () => {
  test("retires unused keys, creates missing keys, updates metrics for 18 deployments, and posts drift alerts", async () => {
    const fake = buildFakeFlagsService();
    const registry = new Registry();
    const metrics = createFlagInventoryMetrics(registry);
    const postedAlerts: AlertmanagerAlert[] = [];
    const fixedNow = new Date("2026-11-22T00:00:00.000Z");

    const results = await reconcileFlagsInventory({
      url: "https://flags.example.test",
      token: "machine-secret",
      alertmanagerUrl: "https://alertmanager.example.test",
      upstreamFetch: fake.upstreamFetch,
      metrics,
      postAlerts: (alerts) => {
        postedAlerts.push(...alerts);
        return Promise.resolve();
      },
      now: () => fixedNow,
    });

    expect(results).toHaveLength(18);
    expect(
      fake.authHeaders.every((header) => header === "Bearer machine-secret"),
    ).toBe(true);

    const scoutBeta = results.find(
      (entry) => entry.deployment === "scout/beta",
    );
    expect(scoutBeta?.retiredFlags).toEqual(["ai_reviews_enabled"]);
    expect(scoutBeta?.missingFlags).toEqual([]);
    expect(scoutBeta?.extraFlags).toEqual([]);
    expect(scoutBeta?.contractMismatches).toEqual([]);

    const golinkProd = results.find(
      (entry) => entry.deployment === "golink/prod",
    );
    expect(golinkProd?.createdFlags).toEqual([
      "golink-dynamic-aliases-enabled",
    ]);
    expect(golinkProd?.missingFlags).toEqual([]);

    const scoutProd = results.find(
      (entry) => entry.deployment === "scout/prod",
    );
    expect(scoutProd?.extraFlags).toEqual(["manual-extra-flag"]);
    expect(scoutProd?.contractMismatches).toEqual([
      "dares_enabled: expected default false, got true",
    ]);

    expect(postedAlerts).toHaveLength(18);
    const scoutProdAlert = postedAlerts.find(
      (alert) => alert.labels["deployment"] === "scout/prod",
    );
    const scoutBetaAlert = postedAlerts.find(
      (alert) => alert.labels["deployment"] === "scout/beta",
    );
    expect(scoutProdAlert?.labels["alertname"]).toBe("FlagsManagedFlagDrift");
    expect(scoutProdAlert?.endsAt).not.toBe(scoutProdAlert?.startsAt);
    expect(scoutBetaAlert?.endsAt).toBe(scoutBetaAlert?.startsAt);

    const metricsText = await registry.metrics();
    expect(metricsText).toContain(
      'feature_flag_inventory_observed_timestamp_seconds{deployment="golink/prod"}',
    );
    expect(metricsText).toContain(
      'feature_flag_inventory_observed_timestamp_seconds{deployment="storm/prod"}',
    );
    expect(metricsText).not.toContain('deployment="justin/');
  });

  test("requires FLAGS_URL and FLAGS_MACHINE_TOKEN in activity entrypoint", async () => {
    const previousUrl = Bun.env["FLAGS_URL"];
    const previousToken = Bun.env["FLAGS_MACHINE_TOKEN"];
    try {
      delete Bun.env["FLAGS_URL"];
      delete Bun.env["FLAGS_MACHINE_TOKEN"];
      await expect(checkFlagInventory()).rejects.toThrow(
        /FLAGS_URL is required/,
      );
    } finally {
      if (previousUrl !== undefined) Bun.env["FLAGS_URL"] = previousUrl;
      if (previousToken !== undefined) {
        Bun.env["FLAGS_MACHINE_TOKEN"] = previousToken;
      }
    }
  });
});
