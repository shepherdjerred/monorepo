import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createFlagsApp } from "./app.ts";
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
