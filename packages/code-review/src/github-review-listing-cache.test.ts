import { afterEach, describe, expect, test, vi } from "vitest";
import {
  REVIEW_LISTING_MAX_AGE_MS,
  ReviewListingCache,
  reviewListingChangeSignal,
} from "./github-review-listing-cache.ts";
import type { ReviewListing } from "./github-review-snapshot.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const input = { repo: "o/r", number: 7, token: "token" };

function listing(tag: string): ReviewListing {
  return { threadPayloads: [tag], reviewPayloads: [], headRefOid: null };
}

function harness() {
  const clock = { now: 0 };
  const signal = { value: "s1" };
  const order: string[] = [];
  const fetch = vi.fn(async () => {
    order.push("fetch");
    return listing(`listing-${String(fetch.mock.calls.length)}`);
  });
  const cache = new ReviewListingCache({
    now: () => clock.now,
    fetch,
    signal: async () => {
      order.push("signal");
      return signal.value;
    },
  });
  return { cache, clock, signal, fetch, order };
}

describe("ReviewListingCache", () => {
  test("reuses the listing while the change signal holds", async () => {
    const { cache, clock, fetch } = harness();
    cache.beginTick();
    const first = await cache.get(input);
    cache.beginTick();
    clock.now = REVIEW_LISTING_MAX_AGE_MS - 1;
    expect(await cache.get(input)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.reused).toBe(1);
    expect(cache.reusedEarlierTick).toBe(true);
  });

  test("re-lists as soon as the change signal moves", async () => {
    const { cache, signal, fetch } = harness();
    await cache.get(input);
    signal.value = "s2";
    const relisted = await cache.get(input);
    expect(relisted.threadPayloads).toEqual(["listing-2"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("re-lists once the held listing reaches its maximum age", async () => {
    const { cache, clock, fetch } = harness();
    await cache.get(input);
    clock.now = REVIEW_LISTING_MAX_AGE_MS;
    await cache.get(input);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("reads the signal before the listing so a change in between is not hidden", async () => {
    const { cache, order } = harness();
    await cache.get(input);
    expect(order).toEqual(["signal", "fetch"]);
  });

  test("sharing within one tick is not reuse from an earlier tick", async () => {
    const { cache, fetch } = harness();
    cache.beginTick();
    await cache.get(input);
    await cache.get(input);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.reusedEarlierTick).toBe(false);
  });

  test("invalidate forces a fresh listing", async () => {
    const { cache, fetch } = harness();
    await cache.get(input);
    cache.invalidate();
    await cache.get(input);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("never serves one pull request's listing for another", async () => {
    const { cache, fetch } = harness();
    await cache.get(input);
    await cache.get({ ...input, number: 8 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

function stubBodies(bodies: Map<string, string>) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const path = new URL(url).pathname;
      return new Response(bodies.get(path) ?? "[]", { status: 200 });
    }),
  );
  return urls;
}

describe("reviewListingChangeSignal", () => {
  test("reads reviews and the most recently updated review comment", async () => {
    const urls = stubBodies(new Map());
    await reviewListingChangeSignal({ ...input, token: "signal-urls" });
    expect(urls).toEqual([
      "https://api.github.com/repos/o/r/pulls/7/reviews?per_page=100",
      "https://api.github.com/repos/o/r/pulls/7/comments?sort=updated&direction=desc&per_page=1",
    ]);
  });

  test("moves when a review or a review comment changes", async () => {
    const bodies = new Map<string, string>();
    stubBodies(bodies);
    const token = "signal-moves";
    const before = await reviewListingChangeSignal({ ...input, token });
    expect(await reviewListingChangeSignal({ ...input, token })).toBe(before);
    bodies.set("/repos/o/r/pulls/7/comments", '[{"id":1}]');
    const afterComment = await reviewListingChangeSignal({ ...input, token });
    expect(afterComment).not.toBe(before);
    bodies.set("/repos/o/r/pulls/7/reviews", '[{"id":2}]');
    expect(await reviewListingChangeSignal({ ...input, token })).not.toBe(
      afterComment,
    );
  });

  test("fails loudly when GitHub refuses a signal read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(
      reviewListingChangeSignal({ ...input, token: "signal-404" }),
    ).rejects.toThrow(/404/u);
  });
});
