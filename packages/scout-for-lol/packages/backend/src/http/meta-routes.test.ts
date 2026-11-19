import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createMetaRateLimiter,
  handleMetaRoute,
  type MetaRateLimiter,
} from "#src/http/meta-routes.ts";
import type { MetaReader } from "#src/meta/meta-reader.ts";
import {
  EMPTY_META_READER,
  fixtureMetaReader,
} from "#src/meta/meta-test-fixture.ts";

/** Route behaviour over the in-memory meta: no lake, DuckDB or database. */

const BASE = "https://scout.test";

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

async function statusOf(response: Promise<Response>): Promise<number> {
  const settled = await response;
  return settled.status;
}

async function bodyOf(path: string): Promise<unknown> {
  const response = await get(path);
  return await response.json();
}

async function errorCode(response: Response): Promise<string> {
  return ErrorBodySchema.parse(await response.json()).error.code;
}

function limiter(): MetaRateLimiter {
  return createMetaRateLimiter();
}

async function get(
  path: string,
  options: {
    reader?: MetaReader;
    limiter?: MetaRateLimiter;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<Response> {
  const url = new URL(`${BASE}${path}`);
  const response = await handleMetaRoute(
    new Request(url.toString(), {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
    }),
    url,
    {
      reader: options.reader ?? fixtureMetaReader(),
      limiter: options.limiter ?? limiter(),
    },
  );
  if (response === null) throw new Error(`${path} was not a meta route`);
  return response;
}

describe("meta routes", () => {
  test("ignores paths outside /api/meta/v1/", async () => {
    const url = new URL(`${BASE}/api/version`);
    expect(
      await handleMetaRoute(new Request(url.toString()), url, {
        reader: fixtureMetaReader(),
        limiter: limiter(),
      }),
    ).toBeNull();
  });

  test("manifest is public, cacheable and names the build", async () => {
    const response = await get("/api/meta/v1/manifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("ETag")).toMatch(/^W\/"meta1-/u);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      buildId: "fixture-build",
      defaults: { patch: "16.3", queueId: 420, bracket: "all" },
    });
  });

  test("a matching If-None-Match is a bodiless 304 with the same validators", async () => {
    const first = await get("/api/meta/v1/tiers");
    const etag = first.headers.get("ETag") ?? "";
    const second = await get("/api/meta/v1/tiers", {
      headers: { "If-None-Match": etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe(
      first.headers.get("Cache-Control"),
    );
    // A different slice is a different representation.
    const other = await get("/api/meta/v1/tiers?patch=16.2");
    expect(other.headers.get("ETag")).not.toBe(etag);
  });

  test("tiers state patch, queue, bracket and sample size", async () => {
    expect(await bodyOf("/api/meta/v1/tiers")).toMatchObject({
      context: {
        patch: "16.3",
        queueId: 420,
        queue: "ranked_solo",
        bracket: "all",
      },
      sample: { matches: 1000 },
      entries: [
        expect.objectContaining({
          championName: "Ahri",
          tier: "S",
          games: 500,
          winRate: expect.objectContaining({ lower: expect.any(Number) }),
        }),
        expect.anything(),
        expect.anything(),
      ],
    });
  });

  test("champion slices carry their context and sample; query selects the slice", async () => {
    expect(await bodyOf("/api/meta/v1/champions/2")).toMatchObject({
      championId: 2,
      championName: "Ahri",
      context: { patch: "16.3", queueId: 420, bracket: "all" },
      slices: [{ sample: { games: 500, matches: 1000 } }],
    });
    expect(
      await bodyOf("/api/meta/v1/champions/2?patch=16.2&role=middle"),
    ).toMatchObject({
      slices: [{ context: { patch: "16.2" }, sample: { games: 200 } }],
    });
  });

  test("matchups return the head-to-head record with its games", async () => {
    const response = await get("/api/meta/v1/matchups/2/3");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      championName: "Ahri",
      opponentName: "Annie",
      context: { patch: "16.3", bracket: "all" },
      slices: [{ games: 80, wins: 50 }],
    });
  });

  test("unknown champions are a typed 404, as is a matchup without enough games", async () => {
    for (const path of [
      "/api/meta/v1/champions/999",
      "/api/meta/v1/champions/ahri",
      "/api/meta/v1/champions/4",
      "/api/meta/v1/matchups/2/999",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(await errorCode(response), path).toBe("unknown_champion");
    }
    const none = await get("/api/meta/v1/matchups/1/2");
    expect(none.status).toBe(404);
    expect(await errorCode(none)).toBe("matchup_not_found");
    const noSlice = await get("/api/meta/v1/champions/3?patch=16.2");
    expect(noSlice.status).toBe(404);
    expect(await errorCode(noSlice)).toBe("slice_not_found");
    expect(noSlice.headers.get("Cache-Control")).toBe("no-store");
  });

  test("a malformed query is a typed 400", async () => {
    for (const query of [
      "patch=latest",
      "queue=1700",
      "bracket=gold",
      "role=mid",
    ]) {
      const response = await get(`/api/meta/v1/champions/2?${query}`);
      expect(response.status, query).toBe(400);
      expect(await errorCode(response), query).toBe("invalid_selection");
    }
  });

  test("is read-only", async () => {
    const response = await get("/api/meta/v1/manifest", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    const head = await get("/api/meta/v1/manifest", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("answers 503 until meta is published", async () => {
    const response = await get("/api/meta/v1/manifest", {
      reader: EMPTY_META_READER,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(await errorCode(response)).toBe("meta_unavailable");
  });

  test("unknown meta paths are 404", async () => {
    expect(await statusOf(get("/api/meta/v1/nope"))).toBe(404);
  });
});

describe("meta rate limit", () => {
  test("limits each IP separately, and a refused caller does not spend the shared budget", async () => {
    let now = 1_000_000;
    const clocked = createMetaRateLimiter({
      perCallerMax: 2,
      globalMax: 4,
      windowMs: 60_000,
      now: () => now,
    });
    const from = async (ip: string) =>
      await get("/api/meta/v1/manifest", {
        limiter: clocked,
        headers: { "CF-Connecting-IP": ip },
      });
    expect(await statusOf(from("1.1.1.1"))).toBe(200);
    expect(await statusOf(from("1.1.1.1"))).toBe(200);
    const refused = await from("1.1.1.1");
    expect(refused.status).toBe(429);
    expect(await errorCode(refused)).toBe("rate_limited");
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Refusals were free: two more callers still fit the global cap of four.
    expect(await statusOf(from("2.2.2.2"))).toBe(200);
    expect(await statusOf(from("3.3.3.3"))).toBe(200);
    expect(await statusOf(from("4.4.4.4"))).toBe(429);
    now += 60_000;
    expect(await statusOf(from("1.1.1.1"))).toBe(200);
  });

  test("keys on the forwarded client address when there is no Cloudflare header", async () => {
    const strict = createMetaRateLimiter({ perCallerMax: 1 });
    const call = async (forwarded: string) =>
      await get("/api/meta/v1/manifest", {
        limiter: strict,
        headers: { "X-Forwarded-For": forwarded },
      });
    expect(await statusOf(call("9.9.9.9, 10.0.0.1"))).toBe(200);
    expect(await statusOf(call("9.9.9.9, 10.0.0.2"))).toBe(429);
    expect(await statusOf(call("8.8.8.8"))).toBe(200);
  });
});
