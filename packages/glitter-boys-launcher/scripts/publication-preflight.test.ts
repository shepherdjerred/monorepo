import { expect, test } from "bun:test";
import { publicationPreflight } from "../../../scripts/release/publish-launcher.ts";

test("a missing bucket cannot be mistaken for an unused release version", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env["SEAWEEDFS_SITES_ACCESS_KEY_ID"];
  const originalSecret = process.env["SEAWEEDFS_SITES_SECRET_ACCESS_KEY"];
  process.env["SEAWEEDFS_SITES_ACCESS_KEY_ID"] = "test-key";
  process.env["SEAWEEDFS_SITES_SECRET_ACCESS_KEY"] = "test-secret";
  const requests: Request[] = [];
  let bucketExists = false;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      const bucket =
        new URL(request.url).pathname.replace(/\/$/, "") === "/glitter-boys";
      return new Response(null, { status: bucket && bucketExists ? 200 : 404 });
    }) as typeof fetch;
    await expect(publicationPreflight("0.1.7")).rejects.toThrow(
      "Could not access publication bucket: HTTP 404",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("HEAD");
    requests.length = 0;
    bucketExists = true;
    await expect(publicationPreflight("0.1.7")).resolves.toBeUndefined();
    expect(requests.map((request) => request.method)).toEqual([
      "HEAD",
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
