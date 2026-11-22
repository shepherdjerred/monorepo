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
    store.seedFromInventory();
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
    const snapshot = await app.request("/v1/deployments/scout/prod/snapshot");
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get("content-type")).toContain("application/json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starts FLAGS_EVALUATION_PORT with credentialless evaluation only and stops both listeners", async () => {
  const previousEvalPort = Bun.env["FLAGS_EVALUATION_PORT"];
  const previousDbPath = Bun.env["FLAGS_DATABASE_PATH"];
  const previousFliptUrl = Bun.env["FLAGS_FLIPT_URL"];
  const previousProxies = Bun.env["FLAGS_TRUSTED_PROXIES"];
  Bun.env["FLAGS_EVALUATION_PORT"] = "0";
  Bun.env["FLAGS_DATABASE_PATH"] = ":memory:";
  delete Bun.env["FLAGS_FLIPT_URL"];
  Bun.env["FLAGS_TRUSTED_PROXIES"] = "10.244.0.0/16";

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
  } finally {
    await started.stop(true);
    if (previousEvalPort === undefined) delete Bun.env["FLAGS_EVALUATION_PORT"];
    else Bun.env["FLAGS_EVALUATION_PORT"] = previousEvalPort;
    if (previousDbPath === undefined) delete Bun.env["FLAGS_DATABASE_PATH"];
    else Bun.env["FLAGS_DATABASE_PATH"] = previousDbPath;
    if (previousFliptUrl === undefined) delete Bun.env["FLAGS_FLIPT_URL"];
    else Bun.env["FLAGS_FLIPT_URL"] = previousFliptUrl;
    if (previousProxies === undefined) delete Bun.env["FLAGS_TRUSTED_PROXIES"];
    else Bun.env["FLAGS_TRUSTED_PROXIES"] = previousProxies;
  }
});
