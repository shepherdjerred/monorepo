import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
  REDDIT_OUTREACH_POST_PAGE_SIZE,
  RedditOutreachPostPageSchema,
  type RedditOutreachPost,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import {
  readRedditSweepPostPage,
  recordSweep,
} from "#activities/promotion/reddit-outreach/sweep-audit.ts";
const storage = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("#activities/reports/report-object-store.ts", async (original) => ({
  ...(await original<object>()),
  reportReceiptStore: () => ({
    client: { send: storage.send },
    bucket: "fixture",
  }),
}));
import { promotionStatusFetch } from "./status-server.ts";
import { readProductionPromotionStatus } from "./status.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
afterEach(() => {
  vi.unstubAllEnvs();
  storage.send.mockReset();
});

it("serves only known promotion evidence with restrictive response headers", async () => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  const data = await readProductionPromotionStatus(memoryPromotionStore());
  const id = "a".repeat(64),
    forbidden = "b".repeat(64);
  data.evidence.set(id, "storm/promotion/v1/prod/evidence/fixture.png");
  data.evidence.set(forbidden, "private/unrelated.png");
  storage.send.mockResolvedValue({
    Body: {
      transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    },
  });
  const handle = promotionStatusFetch("fixture-token", () =>
    Promise.resolve(data),
  );
  const request = (key: string) =>
    handle(
      new Request(`http://status/api/v1/promotion/evidence/${key}`, {
        headers: { authorization: "Bearer fixture-token" },
      }),
    );
  const denied = await request(forbidden);
  expect(denied.status).toBe(404);
  expect(storage.send).not.toHaveBeenCalled();
  const response = await request(id);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(storage.send).toHaveBeenCalledTimes(1);
});

it("authenticates reads and rejects mutations, invalid cursors and unknown evidence", async () => {
  const store = memoryPromotionStore();
  const read = vi.fn(() => readProductionPromotionStatus(store));
  const handle = promotionStatusFetch("fixture-token", read);
  const request = (url: string, method = "GET", token = "fixture-token") =>
    handle(
      new Request(`http://status${url}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  const denied = await request("/api/v1/promotion", "GET", "wrong");
  expect(denied.status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  const mutation = await request("/api/v1/promotion", "POST");
  expect(mutation.status).toBe(405);
  expect(read).not.toHaveBeenCalled();
  const overview = await request("/api/v1/promotion");
  expect(overview.status).toBe(200);
  const data: unknown = await overview.json();
  expect(data).toHaveProperty("scheduling", "scheduled");
  const cursor = await request("/api/v1/promotion/history?cursor=unknown");
  expect(cursor.status).toBe(400);
  const evidence = await request(
    `/api/v1/promotion/evidence/${"0".repeat(64)}`,
  );
  expect(evidence.status).toBe(404);
});

it("keeps the production overview available when the outreach status read fails", async () => {
  const store = memoryPromotionStore();
  const readRedditOutreach = vi
    .fn()
    .mockRejectedValue(new Error("private outreach failure"));
  const handle = promotionStatusFetch("fixture-token", () =>
    readProductionPromotionStatus(store, { readRedditOutreach }),
  );
  const response = await handle(
    new Request("http://status/api/v1/promotion", {
      headers: { authorization: "Bearer fixture-token" },
    }),
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    scheduling: "scheduled",
    redditOutreach: { status: "unavailable" },
  });
  expect(JSON.stringify(body)).not.toContain("private outreach failure");
});

it("pages authenticated Reddit post rows and preserves legacy audit behavior", async () => {
  const store = memoryPromotionStore();
  const runId = "the-storm-reddit-outreach-workflow-2026-11-22T07:00:00Z/run";
  const summary = {
    occurrenceId: runId,
    completedAt: "2026-11-22T19:00:00.000Z",
    preview: false,
    inspected: REDDIT_OUTREACH_POST_PAGE_SIZE + 1,
    assessed: 0,
    cached: 0,
    failures: [],
    replies: [],
    drafts: [],
  };
  const posts = Array.from(
    { length: REDDIT_OUTREACH_POST_PAGE_SIZE + 1 },
    (_, index): RedditOutreachPost => ({
      id: String(index),
      subreddit: "MinecraftServer",
      title: `Survival request ${String(index)}`,
      url: `https://www.reddit.com/r/MinecraftServer/comments/${String(index)}/`,
      score: null,
      result: "pending",
      reason: null,
    }),
  );
  await recordSweep(store, summary, posts);
  await recordSweep(store, { ...summary, occurrenceId: "legacy/run" });
  const dayIndex = await store.read(
    "reddit-outreach/sweep-days/2026-11-22.json",
    z.record(z.string(), z.unknown()),
  );
  expect(dayIndex?.value[runId]).toBeDefined();
  expect(dayIndex?.value[runId]).not.toHaveProperty("posts");

  const readPosts = vi.fn(async (id: string, offset: number) =>
    readRedditSweepPostPage(store, id, offset),
  );
  const handle = promotionStatusFetch(
    "fixture-token",
    () => readProductionPromotionStatus(store),
    readPosts,
  );
  const request = (query: string, token = "fixture-token") =>
    handle(
      new Request(`http://status/api/v1/promotion/reddit-posts?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  const query = new URLSearchParams({ runId }).toString();
  const denied = await request(query, "wrong");
  expect(denied.status).toBe(401);
  for (const invalid of [
    "runId=bad",
    `${query}&offset=-1`,
    `${query}&offset=1501`,
    `${query}&offset=0&offset=1`,
  ]) {
    const response = await request(invalid);
    expect(response.status).toBe(400);
  }
  expect(readPosts).not.toHaveBeenCalled();

  const response = await request(query);
  const first = RedditOutreachPostPageSchema.parse(await response.json());
  expect(first).toEqual({
    status: "available",
    posts: posts.slice(0, REDDIT_OUTREACH_POST_PAGE_SIZE),
    nextOffset: REDDIT_OUTREACH_POST_PAGE_SIZE,
  });
  const tail = await request(
    `${query}&offset=${String(REDDIT_OUTREACH_POST_PAGE_SIZE)}`,
  );
  expect(RedditOutreachPostPageSchema.parse(await tail.json())).toEqual({
    status: "available",
    posts: posts.slice(REDDIT_OUTREACH_POST_PAGE_SIZE),
    nextOffset: null,
  });
  const legacy = await request("runId=legacy%2Frun");
  expect(RedditOutreachPostPageSchema.parse(await legacy.json())).toEqual({
    status: "unavailable",
  });
});

it("completes a >10s status read over Bun.serve without closing the idle socket (AI-834)", async () => {
  const store = memoryPromotionStore();
  const baseData = await readProductionPromotionStatus(store);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 30,
    fetch: promotionStatusFetch("fixture-token", async () => {
      await Bun.sleep(10_500);
      return baseData;
    }),
  });
  try {
    expect(server.port).toBeGreaterThan(0);
    const response = await fetch(
      `http://127.0.0.1:${String(server.port)}/api/v1/promotion`,
      {
        headers: { authorization: "Bearer fixture-token" },
        signal: AbortSignal.timeout(15_000),
      },
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toHaveProperty("scheduling", "scheduled");
  } finally {
    await server.stop(true);
  }
}, 20_000);

it("parallelizes independent status read branches and caches settled batch cleanups (AI-834)", async () => {
  const backing = memoryPromotionStore();
  await backing.put("batches/index.json", ["batch-settled"], undefined);
  await backing.put(
    "batches/batch-settled.json",
    {
      version: 1,
      id: "batch-settled",
      pid: 1234,
      mode: "run",
      startedAt: "2026-11-22T07:00:00.000Z",
      updatedAt: "2026-11-22T07:05:00.000Z",
      finishedAt: "2026-11-22T07:05:00.000Z",
      entries: [
        {
          targetId: "disboard-native-bump",
          status: "completed",
          phase: "verified",
          summary: "Bumped",
          startedAt: "2026-11-22T07:00:00.000Z",
          finishedAt: "2026-11-22T07:05:00.000Z",
          occurrenceId: "occ-1",
        },
      ],
    },
    undefined,
  );
  await backing.put(
    "cleanup/occ-1.json",
    {
      status: "deleted",
      summary: "Removed transient message",
    },
    undefined,
  );

  const startedBranches = new Set<string>();
  let releaseBarrier: (() => void) | undefined;
  const allThreeStarted = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const cleanupReads: string[] = [];
  let gateInitialReads = true;

  const instrumentedStore = {
    ...backing,
    read: async <T>(key: string, schema: z.ZodType<T>) => {
      if (key.startsWith("cleanup/")) cleanupReads.push(key);
      if (gateInitialReads) {
        if (key.startsWith("targets/")) startedBranches.add("states");
        if (key === "batches/index.json") startedBranches.add("batches");
        if (key.startsWith("ai/daily/") || key.startsWith("solver/"))
          startedBranches.add("spend");
        if (startedBranches.size === 3) releaseBarrier?.();
        if (
          key === "batches/index.json" ||
          key.startsWith("targets/") ||
          key.startsWith("ai/daily/")
        ) {
          await allThreeStarted;
        }
      }
      return await backing.read(key, schema);
    },
  };

  const first = await readProductionPromotionStatus(instrumentedStore);
  expect([...startedBranches].sort()).toEqual(["batches", "spend", "states"]);
  expect(cleanupReads).toEqual(["cleanup/occ-1.json"]);
  expect(
    first.history.find(
      (entry) => entry.id === "batch:batch-settled:disboard-native-bump",
    )?.cleanup,
  ).toBe("deleted: Removed transient message");

  gateInitialReads = false;
  const second = await readProductionPromotionStatus(instrumentedStore);
  // Settled batch and its settled cleanup are both served from cache.
  expect(cleanupReads).toEqual(["cleanup/occ-1.json"]);
  expect(
    second.history.find(
      (entry) => entry.id === "batch:batch-settled:disboard-native-bump",
    )?.cleanup,
  ).toBe("deleted: Removed transient message");
});
