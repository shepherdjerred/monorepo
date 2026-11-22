import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createFlagsApp } from "./app.ts";
import { startServer } from "./server.ts";
import { FlagStore } from "./store.ts";

const ENV_KEYS = [
  "FLAGS_EVALUATION_PORT",
  "FLAGS_DATABASE_PATH",
  "FLAGS_FLIPT_URL",
  "FLAGS_TRUSTED_PROXIES",
  "FLAGS_INGRESS_IDENTITY_DIR",
] as const;

type EnvOverrides = Partial<
  Record<(typeof ENV_KEYS)[number], string | undefined>
>;

function applyEnvKey(
  key: (typeof ENV_KEYS)[number],
  value: string | undefined,
): void {
  if (value === undefined) Reflect.deleteProperty(Bun.env, key);
  else Bun.env[key] = value;
}

async function withServerEnv<T>(
  overrides: EnvOverrides,
  run: () => Promise<T>,
): Promise<T> {
  const saved = new Map<(typeof ENV_KEYS)[number], string | undefined>();
  for (const key of ENV_KEYS) {
    saved.set(key, Bun.env[key]);
    applyEnvKey(key, overrides[key]);
  }
  try {
    return await run();
  } finally {
    for (const key of ENV_KEYS) {
      applyEnvKey(key, saved.get(key));
    }
  }
}

function unauthenticatedApp(clientRoot?: string) {
  const store = FlagStore.open(":memory:");
  if (clientRoot !== undefined) store.seedFromInventory();
  return createFlagsApp({
    store,
    auth: {
      machineToken: undefined,
      operatorLogins: [],
      trustedProxyAddresses: [],
      publicOrigin: "https://flags.example.test",
    },
    ...(clientRoot === undefined ? {} : { clientRoot }),
  });
}

test("reports health", async () => {
  const app = unauthenticatedApp();
  const response = await app.request("/healthz");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("answers 404 elsewhere", async () => {
  const app = unauthenticatedApp();
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
    const app = unauthenticatedApp(root);
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
    const snapshot = await app.request("/v1/deployments/scout/prod/snapshot");
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get("content-type")).toContain("application/json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starts FLAGS_EVALUATION_PORT with credentialless evaluation only and stops both listeners", async () => {
  await withServerEnv(
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
        expect(snapshot.headers.get("etag")).toBe('"1"');

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
      } finally {
        await started.stop(true);
      }
    },
  );
});

test("restarts without contacting FLAGS_FLIPT_URL when every deployment is already stored", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flags-sqlite-"));
  try {
    const dbPath = path.join(dir, "flags.sqlite");
    const seededStore = FlagStore.open(dbPath);
    seededStore.seedFromInventory();
    expect(seededStore.missingDeployments()).toEqual([]);
    seededStore.close();

    await withServerEnv(
      {
        FLAGS_DATABASE_PATH: dbPath,
        FLAGS_FLIPT_URL: "http://127.0.0.1:1",
      },
      async () => {
        const started = await startServer(0, "127.0.0.1");
        try {
          const response = await fetch(
            `http://127.0.0.1:${String(started.port)}/v1/deployments/scout/prod/snapshot`,
          );
          expect(response.status).toBe(200);
        } finally {
          await started.stop(true);
        }
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetches only unseeded deployments from FLAGS_FLIPT_URL", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flags-partial-"));
  const requestedPaths: string[] = [];
  const fliptServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      requestedPaths.push(`${url.pathname}${url.search}`);
      if (!url.pathname.endsWith("/scout")) {
        return new Response("already stored deployment must not be fetched", {
          status: 500,
        });
      }
      return Response.json({
        flags: [
          {
            key: "dares_enabled",
            enabled: true,
            type: "BOOLEAN_FLAG_TYPE",
            rules: [],
            rollouts: [],
          },
        ],
      });
    },
  });
  try {
    const dbPath = path.join(dir, "flags.sqlite");
    const seededStore = FlagStore.open(dbPath);
    const initialIds = seededStore
      .missingDeployments()
      .filter((deployment) => deployment.id !== "scout/prod")
      .map((deployment) => ({ id: deployment.id, flags: [] }));
    seededStore.seedDocuments(initialIds);
    expect(seededStore.missingDeployments().map((d) => d.id)).toEqual([
      "scout/prod",
    ]);
    seededStore.close();

    await withServerEnv(
      {
        FLAGS_DATABASE_PATH: dbPath,
        FLAGS_FLIPT_URL: `http://127.0.0.1:${String(fliptServer.port)}`,
      },
      async () => {
        const started = await startServer(0, "127.0.0.1");
        try {
          expect(requestedPaths).toEqual([
            "/internal/v1/evaluation/snapshot/namespace/scout",
          ]);
          const evaluate = await fetch(
            `http://127.0.0.1:${String(started.port)}/v1/evaluate`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                deployment: "scout/prod",
                key: "dares_enabled",
              }),
            },
          );
          expect(evaluate.status).toBe(200);
          expect(await evaluate.json()).toEqual({ enabled: true });
        } finally {
          await started.stop(true);
        }
      },
    );
  } finally {
    await fliptServer.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});
