import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createFacetApp } from "../app.ts";
import { InMemoryFacetStore } from "../v1/stores/in-memory-store.ts";

const TOKEN = "owner-token";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "tasknotes-web-ui-"));
  await Bun.write(
    path.join(root, "index.html"),
    "<!doctype html><title>TaskNotes</title>",
  );
  await mkdir(path.join(root, "assets"));
  await Bun.write(path.join(root, "assets", "app.js"), "asset-body");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function app() {
  return createFacetApp({
    store: new InMemoryFacetStore(),
    getAuthToken: () => TOKEN,
    webRoot: root,
  });
}

test("serves the client without a token and keeps sync gated", async () => {
  const client = app();
  const page = await client.request("/");
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("TaskNotes");

  const asset = await client.request("/assets/app.js");
  expect(asset.status).toBe(200);
  expect(await asset.text()).toBe("asset-body");

  const route = await client.request("/inbox");
  expect(route.status).toBe(200);
  expect(await route.text()).toContain("TaskNotes");

  const missing = await client.request("/assets/missing.js");
  expect(missing.status).toBe(404);

  const head = await client.request("/", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");

  const sync = await client.request("/api/v1/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands: [] }),
  });
  expect(sync.status).toBe(401);
});

test("does not serve a path that escapes the client directory", async () => {
  const outside = path.join(root, "..", "tasknotes-secret.txt");
  await Bun.write(outside, "secret-body");
  try {
    const escaped = await app().request("/assets/../../tasknotes-secret.txt");
    expect(escaped.status).not.toBe(200);
    expect(await escaped.text()).not.toContain("secret-body");
  } finally {
    await rm(outside, { force: true });
  }
});
