import { describe, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  redditCheckpointKey,
  RedditScanCheckpointSchema,
} from "./checkpoint.ts";
import {
  runIncrementalRedditDiscovery,
  type RedditIncrementalInput,
} from "./incremental.ts";

const now = Date.parse("2026-11-20T12:00:00Z");
type Post = { id: string; createdAt: string; pinned?: boolean };
function post(id: string, time = now - 60_000): Post {
  return { id, createdAt: new Date(time).toISOString() };
}
function next(subreddit = "MinecraftServer", token = "abc123") {
  return `https://old.reddit.com/r/${subreddit}/new/?count=25&after=t3_${token}`;
}
function fixture(): RedditIncrementalInput<Post> {
  return {
    store: memoryPromotionStore(),
    subreddits: ["MinecraftServer"],
    preview: false,
    now,
    maxAgeHours: 24,
    postLimit: 1500,
    pageLimit: 12,
    signal: new AbortController().signal,
    readPage: async () => ({ posts: [post("first")], after: null }),
    process: async ({ posts }) => ({
      settledIds: posts.map((item) => item.id),
    }),
    shouldStop: () => {
      return;
    },
  };
}
async function checkpoint(input: RedditIncrementalInput<Post>) {
  const found = await input.store.read(
    redditCheckpointKey("MinecraftServer", input.preview),
    RedditScanCheckpointSchema,
  );
  if (found === undefined) throw new Error("Test checkpoint missing");
  return found.value;
}

describe("Reddit durable incremental windows", () => {
  it("starts with the previous 15 minutes and completes only the frozen window", async () => {
    const input = fixture();
    const process = vi.fn(input.process);
    input.readPage = async () => ({
      posts: [post("fresh"), post("old", now - 16 * 60_000)],
      after: next(),
    });
    const result = await runIncrementalRedditDiscovery({ ...input, process });
    expect(result).toMatchObject({
      stopReason: "exhausted",
      inspected: 2,
      pages: 1,
    });
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        since: now - 15 * 60_000,
        until: now,
        posts: [post("fresh")],
      }),
    );
    expect(await checkpoint(input)).toMatchObject({
      completedThrough: new Date(now).toISOString(),
      pending: null,
    });
  });

  it("persists each settled row even if processing later throws and replays only unfinished rows", async () => {
    const input = fixture();
    input.readPage = async () => ({
      posts: [post("first"), post("second")],
      after: null,
    });
    const interrupted = {
      ...input,
      process: async ({ settle }: Parameters<typeof input.process>[0]) => {
        await settle(["first"]);
        throw new Error("worker stopped during second row");
      },
    };
    await expect(runIncrementalRedditDiscovery(interrupted)).rejects.toThrow(
      "worker stopped",
    );
    expect(await checkpoint(input)).toMatchObject({
      pending: { until: new Date(now).toISOString(), after: null },
      settled: { first: post("first").createdAt },
    });
    const process = vi.fn(input.process);
    await runIncrementalRedditDiscovery({
      ...input,
      now: now + 15 * 60_000,
      process,
    });
    expect(process.mock.calls[0]?.[0].posts.map((item) => item.id)).toEqual([
      "second",
    ]);
    expect(process.mock.calls[0]?.[0].until).toBe(now);
    expect(await checkpoint(input)).toMatchObject({
      completedThrough: new Date(now).toISOString(),
      pending: null,
    });
  });

  it("retains the current page when a thread budget interrupts a partially settled page", async () => {
    const input = fixture();
    input.readPage = async () => ({
      posts: [post("first"), post("second")],
      after: next(),
    });
    const result = await runIncrementalRedditDiscovery({
      ...input,
      process: async ({ settle }) => {
        await settle(["first"]);
        return { stopReason: "thread-budget" };
      },
    });
    expect(result.stopReason).toBe("thread-budget");
    expect(await checkpoint(input)).toMatchObject({
      pending: { after: null },
      completedThrough: new Date(now - 15 * 60_000).toISOString(),
    });
  });

  it("resumes from the last validated Next page and keeps newly arrived posts for the following window", async () => {
    const input = fixture();
    const first = await runIncrementalRedditDiscovery({
      ...input,
      pageLimit: 1,
      readPage: async () => ({ posts: [post("first")], after: next() }),
    });
    expect(first.stopReason).toBe("listing-page-limit");
    const readPage = vi.fn(async () => ({
      posts: [post("arrived-later", now + 60_000), post("second")],
      after: null,
    }));
    const process = vi.fn(input.process);
    await runIncrementalRedditDiscovery({
      ...input,
      now: now + 15 * 60_000,
      readPage,
      process,
    });
    expect(readPage).toHaveBeenCalledWith(
      expect.objectContaining({ after: next() }),
    );
    expect(process.mock.calls[0]?.[0].posts.map((item) => item.id)).toEqual([
      "second",
    ]);
    expect(await checkpoint(input)).toMatchObject({
      completedThrough: new Date(now).toISOString(),
    });
    const nextProcess = vi.fn(input.process);
    await runIncrementalRedditDiscovery({
      ...input,
      now: now + 30 * 60_000,
      readPage,
      process: nextProcess,
    });
    expect(nextProcess.mock.calls[0]?.[0].posts.map((item) => item.id)).toEqual(
      ["arrived-later"],
    );
  });

  it("restarts an expired page once while retaining already settled IDs", async () => {
    const input = fixture();
    await runIncrementalRedditDiscovery({
      ...input,
      pageLimit: 1,
      readPage: async () => ({ posts: [post("first")], after: next() }),
    });
    const expired = new Error("expired cursor");
    const readPage = vi.fn(async ({ after }: { after: string | null }) => {
      if (after !== null) throw expired;
      return { posts: [post("first"), post("second")], after: null };
    });
    const process = vi.fn(input.process);
    const result = await runIncrementalRedditDiscovery({
      ...input,
      readPage,
      process,
      isExpiredCursor: (error) => error === expired,
    });
    expect(result.stopReason).toBe("exhausted");
    expect(readPage.mock.calls.map(([page]) => page.after)).toEqual([
      next(),
      null,
    ]);
    expect(process.mock.calls[0]?.[0].posts.map((item) => item.id)).toEqual([
      "second",
    ]);
  });
});

describe("incremental Reddit scan boundaries", () => {
  it("keeps preview checkpoints independent from live progress", async () => {
    const input = fixture();
    await runIncrementalRedditDiscovery({ ...input, preview: true });
    const process = vi.fn(input.process);
    await runIncrementalRedditDiscovery({ ...input, process });
    expect(process).toHaveBeenCalledTimes(1);
    expect(process.mock.calls[0]?.[0].posts.map((item) => item.id)).toEqual([
      "first",
    ]);
    expect(redditCheckpointKey("MinecraftServer", true)).not.toBe(
      redditCheckpointKey("MinecraftServer", false),
    );
  });

  it("does not let an old pinned post stop chronological pagination", async () => {
    const input = fixture();
    const readPage = vi.fn(async ({ after }: { after: string | null }) =>
      after === null
        ? {
            posts: [
              { ...post("pinned", now - 25 * 3_600_000), pinned: true },
              post("first"),
            ],
            after: next(),
          }
        : { posts: [post("second")], after: null },
    );
    const result = await runIncrementalRedditDiscovery({
      ...input,
      readPage,
      isPinned: (item) => item.pinned === true,
    });
    expect(result.pages).toBe(2);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("expires unread backlog older than the configured 24h bound", async () => {
    const input = fixture();
    await runIncrementalRedditDiscovery({
      ...input,
      pageLimit: 1,
      readPage: async () => ({ posts: [post("first")], after: next() }),
    });
    const later = now + 25 * 3_600_000;
    const process = vi.fn(input.process);
    const readPage = vi.fn(async () => ({
      posts: [post("new", later - 60_000)],
      after: null,
    }));
    await runIncrementalRedditDiscovery({
      ...input,
      now: later,
      readPage,
      process,
    });
    expect(readPage).toHaveBeenCalledWith(
      expect.objectContaining({ after: null }),
    );
    expect(process.mock.calls[0]?.[0].since).toBe(later - 24 * 3_600_000);
    expect(await checkpoint(input)).toMatchObject({
      settled: { new: post("new", later - 60_000).createdAt },
    });
    const state = await checkpoint(input);
    expect(state.settled).not.toHaveProperty("first");
  });

  it("preserves unread rows when a listing ignores the remaining distinct-post limit", async () => {
    const input = fixture();
    const readPage = overflowingPage;
    const result = await runIncrementalRedditDiscovery({
      ...input,
      postLimit: 2,
      readPage,
    });
    expect(result).toMatchObject({ inspected: 2, stopReason: "scan-limit" });
    expect(await checkpoint(input)).toMatchObject({ pending: { after: null } });
    const process = vi.fn(input.process);
    await runIncrementalRedditDiscovery({ ...input, readPage, process });
    expect(process.mock.calls[0]?.[0].posts.map((item) => item.id)).toEqual([
      "three",
    ]);
  });

  it("does not advance when the processor omits a durable disposition", async () => {
    const input = fixture();
    const result = await runIncrementalRedditDiscovery({
      ...input,
      process: async () => ({}),
    });
    expect(result.stopReason).toBe("unsettled-page");
    expect(await checkpoint(input)).toMatchObject({ pending: { after: null } });
  });

  it("normalizes Old Reddit timestamps before checkpointing", async () => {
    const input = fixture();
    const createdAt = post("first").createdAt;
    await runIncrementalRedditDiscovery({
      ...input,
      readPage: async () => ({
        posts: [{ id: "first", createdAt: createdAt.replace("Z", "+00:00") }],
        after: null,
      }),
    });
    const state = await checkpoint(input);
    expect(state.settled).toEqual({ first: createdAt });
  });

  it("applies the 1,500-listing ceiling to the incremental browser path", async () => {
    const input = fixture();
    let rows = 0;
    const result = await runIncrementalRedditDiscovery({
      ...input,
      pageLimit: 80,
      readPage: async ({ after }) => {
        const offset =
          after === null ? 0 : Number(new URL(after).searchParams.get("count"));
        return {
          posts: Array.from({ length: 25 }, (_, index) =>
            post(`p${String(offset + index)}`),
          ),
          after: `https://old.reddit.com/r/MinecraftServer/new/?count=${String(offset + 25)}&after=t3_p${String(offset + 24)}`,
        };
      },
      process: async ({ posts }) => {
        rows += posts.length;
        return { settledIds: posts.map(({ id }) => id) };
      },
    });
    expect(result).toMatchObject({
      stopReason: "scan-limit",
      inspected: 1500,
      pages: 60,
    });
    expect(rows).toBe(1500);
  });

  it("rejects a processor settling a row outside the current page", async () => {
    const input = fixture();
    await expect(
      runIncrementalRedditDiscovery({
        ...input,
        process: async ({ settle }) => {
          await settle(["unseen"]);
          return {};
        },
      }),
    ).rejects.toThrow("outside its current page");
  });
});

async function overflowingPage() {
  return { posts: [post("one"), post("two"), post("three")], after: null };
}
