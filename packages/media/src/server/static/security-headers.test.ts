import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createMediaApp } from "#server/app.ts";
import { fixture, headers } from "#server/http.test-support.ts";
import { mountMediaClient } from "./client.ts";

// Written out, not imported: this is the header a browser must receive.
const POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "font-src 'self'; connect-src 'self'; manifest-src 'self'; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; " +
  "object-src 'none'";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "media-headers-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "index-B7f3kQ2a.js"), "0;");
  await writeFile(path.join(root, "index.html"), "<!doctype html>");
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

describe("security headers", () => {
  test.each([
    ["the application shell", "/library/series/42", {}, 200],
    ["a hashed asset", "/assets/index-B7f3kQ2a.js", {}, 200],
    ["a missing asset", "/assets/index-00000000.js", {}, 404],
    ["a served API response", "/api/v1/admin/capacity", headers, 200],
    ["a refused API response", "/api/v1/admin/capacity", {}, 401],
    ["an unknown API route", "/api/v1/no-such-route", headers, 404],
    ["the health check", "/health", {}, 200],
  ])("%s carries the policy", async (_name, route, sent, status) => {
    const response = await app().request(route, { headers: sent });
    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Security-Policy")).toBe(POLICY);
    // Never report-only, and never a second policy to intersect with.
    expect(
      response.headers.get("Content-Security-Policy-Report-Only"),
    ).toBeNull();
    // The older header agrees with `frame-ancestors 'none'`.
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    // The defaults the application has always sent are still there.
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
  });
});
