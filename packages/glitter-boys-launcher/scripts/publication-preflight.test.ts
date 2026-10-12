import { expect, test } from "bun:test";
import {
  publicationPreflight,
  verifyHelpGuides,
} from "../../../scripts/release/publish-launcher.ts";

test("a missing bucket cannot be mistaken for an unused release version", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env["SEAWEEDFS_SITES_ACCESS_KEY_ID"];
  const originalSecret = process.env["SEAWEEDFS_SITES_SECRET_ACCESS_KEY"];
  process.env["SEAWEEDFS_SITES_ACCESS_KEY_ID"] = "test-key";
  process.env["SEAWEEDFS_SITES_SECRET_ACCESS_KEY"] = "test-secret";
  const requests: Request[] = [];
  let bucketExists = false;
  let guidesExist = false;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      const bucket =
        new URL(request.url).pathname.replace(/\/$/, "") === "/glitter-boys";
      const guide = new URL(request.url).hostname === "glitter-boys.com";
      return new Response(null, {
        status: (bucket && bucketExists) || (guide && guidesExist) ? 200 : 404,
      });
    }) as typeof fetch;
    await expect(publicationPreflight("0.1.7")).rejects.toThrow(
      "Could not access publication bucket: HTTP 404",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("HEAD");
    requests.length = 0;
    bucketExists = true;
    await expect(publicationPreflight("0.1.7")).rejects.toThrow(
      "/docs/launcher/ returned HTTP 404",
    );
    expect(requests.map((request) => request.method)).toEqual(["HEAD", "GET"]);
    requests.length = 0;
    guidesExist = true;
    await expect(publicationPreflight("0.1.7")).resolves.toBeUndefined();
    expect(requests.map((request) => request.method)).toEqual([
      "HEAD",
      "GET",
      "GET",
      "GET",
      "HEAD",
      "HEAD",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["SEAWEEDFS_SITES_ACCESS_KEY_ID", originalKey],
      ["SEAWEEDFS_SITES_SECRET_ACCESS_KEY", originalSecret],
    ] as const) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  }
});

test("both native Help routes must be reachable before release", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; init?: RequestInit }[] = [];
  let failingRoute: string | undefined;
  try {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({ url, init });
      return new Response(null, { status: url === failingRoute ? 404 : 200 });
    }) as typeof fetch;
    await verifyHelpGuides();
    expect(requests.map(({ url }) => url)).toEqual([
      "https://glitter-boys.com/docs/launcher/",
      "https://glitter-boys.com/docs/",
    ]);
    expect(requests.every(({ init }) => init?.redirect === "error")).toBe(true);
    for (const { url } of requests.slice()) {
      failingRoute = url;
      await expect(verifyHelpGuides()).rejects.toThrow(
        `${url} returned HTTP 404`,
      );
    }
    globalThis.fetch = (async () => {
      throw new TypeError("DNS unavailable");
    }) as typeof fetch;
    await expect(verifyHelpGuides()).rejects.toThrow("DNS unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
