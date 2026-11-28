import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createFlagsApp } from "./app.ts";
import { startServer } from "./server.ts";
import { FlagStore } from "./store.ts";

test("reports health", async () => {
  const store = FlagStore.open(":memory:");
  const app = createFlagsApp({
    store,
    auth: {
      machineToken: undefined,
      operatorLogins: [],
      trustedProxyAddresses: [],
      publicOrigin: "https://flags.example.test",
    },
  });
  const response = await app.request("/healthz");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("answers 404 elsewhere", async () => {
  const store = FlagStore.open(":memory:");
  const app = createFlagsApp({
    store,
    auth: {
      machineToken: undefined,
      operatorLogins: [],
      trustedProxyAddresses: [],
      publicOrigin: "https://flags.example.test",
    },
  });
  const missing = await app.request("/");
  expect(missing.status).toBe(404);
});

test("serves the operator client without covering evaluation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "flags-client-"));
  try {
    await Bun.write(
      path.join(root, "index.html"),
      "<!doctype html><title>Flags</title>",
    );
    await mkdir(path.join(root, "assets"));
    await Bun.write(path.join(root, "assets", "app.js"), "console.log(1)");
    const store = FlagStore.open(":memory:");
    store.seedFromInventory({ kind: "system", id: "seed" });
    const app = createFlagsApp({
      store,
      auth: {
        machineToken: undefined,
        operatorLogins: [],
        trustedProxyAddresses: [],
        publicOrigin: "https://flags.example.test",
      },
      clientRoot: root,
    });
    const page = await app.request("/scout/beta");
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("Flags");
    const asset = await app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const missingAsset = await app.request("/assets/missing.js");
    expect(missingAsset.status).toBe(404);
    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
    const metrics = await app.request("/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain(
      "text/plain; version=0.0.4",
    );
    expect(await metrics.text()).toContain("# TYPE flags_deployments gauge");
    const snapshot = await app.request("/v1/deployments/scout/prod/snapshot");
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get("content-type")).toContain("application/json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const SERVER_ENV_KEYS = [
  "FLAGS_EVALUATION_PORT",
  "FLAGS_DATABASE_PATH",
  "FLAGS_TRUSTED_PROXIES",
  "FLAGS_INGRESS_IDENTITY_DIR",
] as const;

async function withServerEnvironment(
  overrides: Readonly<
    Partial<Record<(typeof SERVER_ENV_KEYS)[number], string | undefined>>
  >,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>(
    SERVER_ENV_KEYS.map((key) => [key, Bun.env[key]]),
  );
  for (const key of SERVER_ENV_KEYS) {
    const next = overrides[key];
    if (next === undefined) Reflect.deleteProperty(Bun.env, key);
    else Bun.env[key] = next;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(Bun.env, key);
      else Bun.env[key] = value;
    }
  }
}

test("starts FLAGS_EVALUATION_PORT with credentialless evaluation only and stops both listeners", async () => {
  await withServerEnvironment(
    {
      FLAGS_EVALUATION_PORT: "0",
      FLAGS_DATABASE_PATH: ":memory:",
      FLAGS_TRUSTED_PROXIES: "127.0.0.1",
    },
    async () => {
      const started = await startServer(0, "127.0.0.1");
      try {
        expect(started.port).toBeGreaterThan(0);
        expect(started.evaluationPort).toBeDefined();
        expect(started.evaluationPort).toBeGreaterThan(0);
        expect(started.evaluationPort).not.toBe(started.port);

        const evalBase = `http://127.0.0.1:${String(started.evaluationPort)}`;
        const health = await fetch(`${evalBase}/healthz`);
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");

        const snapshot = await fetch(
          `${evalBase}/v1/deployments/scout/prod/snapshot`,
        );
        expect(snapshot.status).toBe(200);
        const etag = snapshot.headers.get("etag");
        expect(etag).toBe('"1"');

        const evaluate = await fetch(`${evalBase}/v1/evaluate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deployment: "scout/prod",
            key: "dares_enabled",
          }),
        });
        expect(evaluate.status).toBe(200);
        expect(await evaluate.json()).toEqual({ enabled: false });

        const management = await fetch(`${evalBase}/v1/deployments`, {
          headers: { "tailscale-user-login": "shepherdjerred@gmail.com" },
        });
        expect(management.status).toBe(404);

        const credentialed = await fetch(`${evalBase}/v1/evaluate`, {
          method: "POST",
          headers: {
            authorization: "Bearer secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            deployment: "scout/prod",
            key: "dares_enabled",
          }),
        });
        expect(credentialed.status).toBe(401);

        const evalMetrics = await fetch(`${evalBase}/metrics`);
        expect(evalMetrics.status).toBe(404);

        const primaryMetrics = await fetch(
          `http://127.0.0.1:${String(started.port)}/metrics`,
        );
        expect(primaryMetrics.status).toBe(200);
        expect(primaryMetrics.headers.get("content-type")).toContain(
          "text/plain; version=0.0.4",
        );
        const metricsText = await primaryMetrics.text();
        expect(metricsText).toContain(
          'flags_http_requests_total{surface="evaluation",route="evaluate",status="200"} 1',
        );
        expect(metricsText).toContain(
          'flags_http_requests_total{surface="evaluation",route="evaluate",status="401"} 1',
        );
      } finally {
        await started.stop(true);
      }
    },
  );
});

test("seeds missing deployments from the managed inventory without overwriting existing documents", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flags-sqlite-"));
  const dbPath = path.join(dir, "flags.sqlite");
  const seededStore = FlagStore.open(dbPath);
  const existingDeployments = seededStore
    .missingDeployments()
    .filter((deployment) => deployment.id !== "scout/prod");
  seededStore.seedDocuments(
    [
      {
        id: "scout/beta",
        flags: [
          {
            type: "boolean",
            key: "dares_enabled",
            default: false,
            rollouts: [],
          },
        ],
      },
      ...existingDeployments
        .filter((deployment) => deployment.id !== "scout/beta")
        .map((deployment) => ({ id: deployment.id, flags: [] })),
    ],
    { kind: "system", id: "seed" },
  );
  expect(seededStore.missingDeployments().map((d) => d.id)).toEqual([
    "scout/prod",
  ]);
  seededStore.close();

  try {
    await withServerEnvironment({ FLAGS_DATABASE_PATH: dbPath }, async () => {
      const started = await startServer(0, "127.0.0.1");
      try {
        const prodSnapshot = await fetch(
          `http://127.0.0.1:${String(started.port)}/v1/deployments/scout/prod/snapshot`,
        );
        expect(prodSnapshot.status).toBe(200);

        const betaEvaluate = await fetch(
          `http://127.0.0.1:${String(started.port)}/v1/evaluate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              deployment: "scout/beta",
              key: "dares_enabled",
            }),
          },
        );
        expect(betaEvaluate.status).toBe(200);
        expect(await betaEvaluate.json()).toEqual({ enabled: false });
      } finally {
        await started.stop(true);
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
