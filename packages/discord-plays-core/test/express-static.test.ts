import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Registry } from "prom-client";
import { silentLogger } from "#src/logger.ts";
import { createExpressApp } from "#src/webserver/express.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("serves image web assets without stat-derived cache validators", async () => {
  // Image layers clamp every mtime to one epoch, so size+mtime validators
  // would let a browser keep a changed same-size bundle after a release.
  const root = await mkdtemp(path.join(tmpdir(), "plays-assets-"));
  await writeFile(path.join(root, "index.html"), "<!doctype html>");
  const app = createExpressApp({
    isCorsEnabled: false,
    webAssetsPath: root,
    registry: new Registry(),
    logger: silentLogger,
    assertPathExists: () => {
      /* the temporary directory exists */
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("HTTP server did not bind");

  for (const route of ["/", "/index.html"]) {
    const response = await fetch(
      `http://127.0.0.1:${String(address.port)}${route}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    expect(await response.text()).toBe("<!doctype html>");
  }
});
