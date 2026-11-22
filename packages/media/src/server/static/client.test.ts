import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createMediaApp } from "#server/app.ts";
import { fixture, headers } from "#server/http.test-support.ts";
import { HASHED_ASSET_CACHE_CONTROL, mountMediaClient } from "./client.ts";

const script = 'console.log("media");';
const shell = "<!doctype html><title>Media</title>";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "media-static-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "index-B7f3kQ2a.js"), script);
  await writeFile(path.join(root, "index.html"), shell);
});

afterAll(async () => {
  await rm(root, { recursive: true });
});

/** The production composition: the real application, then the client mount. */
function app() {
  const media = createMediaApp(fixture().dependencies);
  mountMediaClient(media, root);
  return media;
}

describe("browser client caching", () => {
  test("a hashed asset that exists is cacheable for a year and immutable", async () => {
    const response = await app().request("/assets/index-B7f3kQ2a.js");
    expect(response.status).toBe(200);
    expect(HASHED_ASSET_CACHE_CONTROL).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      HASHED_ASSET_CACHE_CONTROL,
    );
    expect(response.headers.get("Content-Type")).toContain("javascript");
    expect(await response.text()).toBe(script);
  });

  test("a missing asset is not found and is never cached", async () => {
    const response = await app().request("/assets/index-00000000.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  // URL parsing folds the first form into `/index.html`, the shell; the second
  // survives parsing and reaches the asset handler with its separator encoded.
  test.each([
    ["/assets/%2e%2e/index.html", 200],
    ["/assets/..%2Findex.html", 404],
  ])(
    "an asset path that escapes the asset directory (%s) is never cached",
    async (route, status) => {
      const response = await app().request(route);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  // `web-app.test.ts` covers the files that exist. One that does not must
  // never be answered with the shell: a browser would read HTML as a manifest.
  test.each(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/"])(
    "a missing web app file (%s) is not found, not the shell, and never cached",
    async (route) => {
      const response = await app().request(route);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("ETag")).toBeNull();
      expect(await response.text()).not.toBe(shell);
    },
  );

  test.each(["/", "/index.html", "/library/series/42"])(
    "the application shell at %s is never cached",
    async (route) => {
      const response = await app().request(route);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toBe(shell);
    },
  );

  test("API responses are never cached, whether refused, served or unknown", async () => {
    const media = app();
    const refused = await media.request("/api/v1/admin/capacity");
    expect(refused.status).toBe(401);
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    const served = await media.request("/api/v1/admin/capacity", { headers });
    expect(served.status).toBe(200);
    expect(served.headers.get("Cache-Control")).toBe("no-store");
    const unknown = await media.request("/api/v1/no-such-route", { headers });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("Cache-Control")).toBe("no-store");
  });
});
