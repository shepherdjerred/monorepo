import { describe, expect, it, vi } from "vitest";
import { runRedditDiscovery } from "./pipeline.ts";

const now = Date.parse("2026-11-19T12:00:00Z");
const since = now - 24 * 60 * 60 * 1000;
type Post = { id: string; createdAt: string };
function post(id: string, time = now): Post {
  return { id, createdAt: new Date(time).toISOString() };
}
function ranked(posts: readonly Post[]) {
  return posts.map((item) => ({ post: item, qualification: true, score: 0.9 }));
}
function defaults() {
  return {
    subreddits: ["one", "two", "three", "four"],
    postLimit: 1500,
    replyLimit: 10,
    since,
    now,
    signal: new AbortController().signal,
    handle: vi.fn(async () => true),
    onInspected: vi.fn(),
  };
}

describe("Reddit paginated discovery", () => {
  it("scans at most 1,500 unique listings across communities in round-robin pages", async () => {
    const input = defaults();
    const readPage = vi.fn(
      async ({
        subreddit,
        after,
        limit,
      }: {
        subreddit: string;
        after: string | null;
        limit: number;
      }) => {
        const page = after === null ? 0 : Number(after);
        return {
          posts: Array.from({ length: limit }, (_, index) =>
            post(`${subreddit}-${String(page * 100 + index)}`),
          ),
          after: String(page + 1),
        };
      },
    );
    const candidates = vi.fn(async (_posts: readonly Post[]) => []);
    const result = await runRedditDiscovery<Post, boolean>({
      ...input,
      readPage,
      candidates,
    });
    expect(result).toBe("scan-limit");
    expect(input.onInspected).toHaveBeenCalledTimes(1500);
    expect(readPage).toHaveBeenCalledTimes(15);
    expect(
      readPage.mock.calls.slice(0, 8).map(([call]) => call.subreddit),
    ).toEqual([...input.subreddits, ...input.subreddits]);
    const assessedIds = candidates.mock.calls.flatMap(([posts]) =>
      posts.map((item) => item.id),
    );
    expect(assessedIds).toHaveLength(1500);
    expect(new Set(assessedIds).size).toBe(1500);
    expect(candidates.mock.calls.every(([posts]) => posts.length <= 8)).toBe(
      true,
    );
    expect(input.handle).not.toHaveBeenCalled();
  });

  it("deduplicates listings and includes the 24h boundary while excluding old and future posts", async () => {
    const input = { ...defaults(), subreddits: ["one", "two"] };
    const readPage = vi.fn(async ({ subreddit }: { subreddit: string }) =>
      subreddit === "one"
        ? {
            posts: [
              post("shared"),
              post("boundary", since),
              post("old", since - 1),
              post("future", now + 1),
            ],
            after: "unused",
          }
        : { posts: [post("shared"), post("fresh")], after: null },
    );
    const observed: string[] = [];
    const candidates = async (posts: readonly Post[]) => {
      observed.push(...posts.map((item) => item.id));
      return [];
    };
    expect(
      await runRedditDiscovery<Post, boolean>({
        ...input,
        readPage,
        candidates,
      }),
    ).toBe("exhausted");
    expect(observed).toEqual(["shared", "boundary", "fresh"]);
    expect(input.onInspected).toHaveBeenCalledTimes(5);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("stops immediately after ten accepted outcomes without paging through the remaining feed", async () => {
    const input = defaults();
    const readPage = vi.fn(async () => ({
      posts: Array.from({ length: 100 }, (_, index) => post(String(index))),
      after: "next",
    }));
    const candidates = vi.fn(async (posts: readonly Post[]) => ranked(posts));
    expect(await runRedditDiscovery({ ...input, readPage, candidates })).toBe(
      "reply-limit",
    );
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(input.handle).toHaveBeenCalledTimes(10);
    expect(candidates).toHaveBeenCalledTimes(2);
  });

  it("continues through declines until ten replies have actually been accepted", async () => {
    const input = defaults();
    const readPage = vi.fn(async () => ({
      posts: Array.from({ length: 40 }, (_, index) => post(String(index))),
      after: null,
    }));
    let accepted = 0;
    const handle = vi.fn(async ({ post: item }: { post: Post }) => {
      const approve = Number(item.id) % 2 === 1;
      if (approve) accepted++;
      return approve;
    });
    const result = await runRedditDiscovery({
      ...input,
      readPage,
      candidates: async (posts) => ranked(posts),
      handle,
    });
    expect(result).toBe("reply-limit");
    expect(accepted).toBe(10);
    expect(handle).toHaveBeenCalledTimes(20);
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it("flushes a small final set of ranked matches after feeds are exhausted", async () => {
    const input = { ...defaults(), subreddits: ["one"] };
    const readPage = vi.fn(async () => ({
      posts: [post("a"), post("b")],
      after: null,
    }));
    const handle = vi
      .fn<(candidate: ReturnType<typeof ranked>[number]) => Promise<boolean>>()
      .mockResolvedValue(true);
    expect(
      await runRedditDiscovery({
        ...input,
        readPage,
        candidates: async (posts) =>
          ranked(posts).map((item, index) => ({
            ...item,
            score: index === 0 ? 0.81 : 0.99,
          })),
        handle,
      }),
    ).toBe("exhausted");
    expect(handle.mock.calls.map(([candidate]) => candidate.post.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("refuses a repeated page cursor rather than looping indefinitely", async () => {
    const input = { ...defaults(), subreddits: ["one"] };
    const readPage = vi.fn(async ({ after }: { after: string | null }) => ({
      posts: [post(after === null ? "first" : "second")],
      after: "repeat",
    }));
    await expect(
      runRedditDiscovery<Post, boolean>({
        ...input,
        readPage,
        candidates: async () => [],
      }),
    ).rejects.toThrow("repeated its pagination cursor");
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("stops without listing or sending after its deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = { ...defaults(), signal: controller.signal };
    const readPage = vi.fn(async () => ({ posts: [post("a")], after: null }));
    expect(
      await runRedditDiscovery<Post, boolean>({
        ...input,
        readPage,
        candidates: async () => [],
      }),
    ).toBe("deadline");
    expect(readPage).not.toHaveBeenCalled();
    expect(input.handle).not.toHaveBeenCalled();
  });
});
