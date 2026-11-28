import { describe, expect, test } from "vitest";
import { matchesAutoReadRule } from "./auto-read.ts";
import { createFeedsPoller } from "./poller.ts";
import type { SafeFetchOptions, SafeFetchResult } from "./ssrf.ts";
import {
  buildStubUserFeedRecord,
  createNoopConsoleQueries,
} from "./test-repo-stub.ts";
import {
  asyncFeedsRepository,
  type SyncFeedsRepository,
} from "./test-async-repository.ts";
import type { ParsedFeedEntry, StoredFeed } from "./types.ts";

function createFakeStore(initialFeeds: readonly StoredFeed[] = []) {
  const feeds = new Map<number, StoredFeed>(initialFeeds.map((f) => [f.id, f]));
  const sessions = new Map<string, { readonly username: string }>();
  let nextFeedId = initialFeeds.length + 1;
  let prunedCalls = 0;
  const notModifiedRecords: { feedId: number; etag: string | null }[] = [];
  const failureRecords: {
    feedId: number;
    status: number | null;
    errorMessage: string;
    nextPollAfterSeconds: number;
  }[] = [];

  const syncStore: SyncFeedsRepository = {
    close: () => {
      /* noop */
    },
    reconcileCatalog: () => ({ upserted: 0, pruned: 0 }),
    pruneOldEntries: () => {
      prunedCalls += 1;
      return 0;
    },
    listFeedsForPoll: (now) =>
      [...feeds.values()].filter(
        (f) => f.nextPollAfter === null || f.nextPollAfter <= now,
      ),
    getFeedById: (id) => feeds.get(id),
    getFeedByUrl: (url) => [...feeds.values()].find((f) => f.url === url),
    recordPollNotModified: (input) => {
      const existing = feeds.get(input.feedId);
      if (existing !== undefined) {
        feeds.set(input.feedId, {
          ...existing,
          lastPolledAt: input.polledAtSeconds,
          lastStatus: 304,
          etag: input.etag ?? existing.etag,
          lastModified: input.lastModified ?? existing.lastModified,
        });
      }
      notModifiedRecords.push({
        feedId: input.feedId,
        etag: input.etag ?? null,
      });
    },
    recordPollSuccess: (input) => {
      const existing = feeds.get(input.feedId);
      let autoRead = 0;
      if (existing?.autoRead !== null && existing?.autoRead !== undefined) {
        for (const entry of input.entries) {
          if (matchesAutoReadRule(existing.autoRead, entry)) {
            autoRead += 1;
          }
        }
      }
      if (existing !== undefined) {
        feeds.set(input.feedId, {
          ...existing,
          etag: input.etag,
          lastModified: input.lastModified,
          htmlUrl: existing.htmlUrl ?? input.discoveredHtmlUrl ?? null,
          lastPolledAt: input.polledAtSeconds,
          lastSuccessAt: input.polledAtSeconds,
          lastStatus: 200,
          lastError: null,
          consecutiveFailures: 0,
          nextPollAfter: null,
        });
      }
      return { inserted: input.entries.length, autoRead };
    },
    recordPollFailure: (input) => {
      const existing = feeds.get(input.feedId);
      if (existing !== undefined) {
        feeds.set(input.feedId, {
          ...existing,
          lastPolledAt: input.polledAtSeconds,
          lastStatus: input.status,
          lastError: input.errorMessage,
          consecutiveFailures: existing.consecutiveFailures + 1,
          nextPollAfter: input.nextPollAfterSeconds,
        });
      }
      failureRecords.push(input);
    },
    ...createNoopConsoleQueries(() => ({
      totalFeeds: feeds.size,
      codeFeeds: 0,
      userFeeds: feeds.size,
    })),
    createUserFeed: (body) => {
      const existing = [...feeds.values()].find((f) => f.url === body.url);
      if (existing !== undefined) {
        return { ok: false, kind: "conflict", message: "Feed already exists" };
      }
      const created = buildStubUserFeedRecord(nextFeedId, 1, body);
      nextFeedId += 1;
      feeds.set(created.id, created);
      return { ok: true, feed: created };
    },
    updateUserFeed: () => ({ ok: false, kind: "not-found", message: "unused" }),
    deleteUserFeed: () => ({ ok: false, kind: "not-found", message: "unused" }),
    createReaderSession: (input) => {
      sessions.set(input.tokenSha256, { username: input.username });
    },
    validateReaderSession: (hash) => sessions.get(hash),
    subscriptionsEtag: () => "1",
    listAllFeeds: () => [...feeds.values()],
    listAllCategories: () => [],
    queryReaderStreamIds: () => ({ ids: [] }),
    getEntriesByIds: () => [],
    editEntryTags: () => 0,
    renameUserCategory: () => ({ ok: true }),
    deleteUserCategory: () => ({ ok: true }),
  };

  return {
    store: asyncFeedsRepository(syncStore),
    feeds,
    notModifiedRecords,
    failureRecords,
    getPrunedCalls: () => prunedCalls,
  };
}

function makeFeed(
  overrides: Partial<StoredFeed> & { id: number; url: string },
): StoredFeed {
  return {
    id: overrides.id,
    url: overrides.url,
    title: overrides.title ?? `Feed ${String(overrides.id)}`,
    categoryId: overrides.categoryId ?? 1,
    categoryLabel: overrides.categoryLabel ?? "Blogs",
    htmlUrl: overrides.htmlUrl ?? null,
    description: overrides.description ?? null,
    source: overrides.source ?? "code",
    hidden: overrides.hidden ?? false,
    autoRead: overrides.autoRead ?? null,
    etag: overrides.etag ?? null,
    lastModified: overrides.lastModified ?? null,
    lastPolledAt: overrides.lastPolledAt ?? null,
    lastSuccessAt: overrides.lastSuccessAt ?? null,
    lastStatus: overrides.lastStatus ?? null,
    lastError: overrides.lastError ?? null,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    nextPollAfter: overrides.nextPollAfter ?? null,
  };
}

const FIXED_NOW = 1_760_000_000;

describe("createFeedsPoller refreshAll", () => {
  test("returns skippedByFlag immediately when shouldRefresh resolves false", async () => {
    const { store, getPrunedCalls } = createFakeStore([
      makeFeed({ id: 1, url: "https://example.com/rss.xml" }),
    ]);
    let fetchCalled = false;
    const poller = createFeedsPoller({
      store,
      shouldRefresh: async () => false,
      fetchFeed: async () => {
        fetchCalled = true;
        throw new Error("should not fetch");
      },
      nowSeconds: () => FIXED_NOW,
    });

    const summary = await poller.refreshAll();
    expect(summary.skippedByFlag).toBe(true);
    expect(summary.polled).toBe(0);
    expect(fetchCalled).toBe(false);
    expect(getPrunedCalls()).toBe(0);
  });

  test("handles 304 conditional GET, 200 updates + autoRead, backedOff count, and pruneOldEntries", async () => {
    const { store, notModifiedRecords, getPrunedCalls } = createFakeStore([
      makeFeed({
        id: 1,
        url: "https://cached.example.com/rss.xml",
        etag: '"etag-v1"',
        lastModified: "Wed, 01 Oct 2025 00:00:00 GMT",
      }),
      makeFeed({
        id: 2,
        url: "https://releases.example.com/atom.xml",
        autoRead: { field: "title", pattern: "alpha|canary", flags: "i" },
      }),
      makeFeed({
        id: 3,
        url: "https://backedoff.example.com/rss.xml",
        nextPollAfter: FIXED_NOW + 600,
      }),
    ]);

    const seenHeaders = new Map<string, Record<string, string>>();
    const poller = createFeedsPoller({
      store,
      concurrency: 2,
      nowSeconds: () => FIXED_NOW,
      fetchFeed: async (
        url: string,
        opts?: SafeFetchOptions,
      ): Promise<SafeFetchResult> => {
        seenHeaders.set(url, opts?.headers ?? {});
        if (url.includes("cached.example.com")) {
          return {
            status: 304,
            headers: new Headers({ etag: '"etag-v1"' }),
            body: "",
            finalUrl: url,
          };
        }
        return {
          status: 206,
          headers: new Headers({
            etag: '"etag-v2"',
            "content-range": "bytes 0-199/200",
          }),
          body: `<rss version="2.0"><channel><title>Rel</title>
            <item><guid>1</guid><title>v2.0.0-canary.1</title></item>
            <item><guid>2</guid><title>v2.0.0</title></item>
          </channel></rss>`,
          finalUrl: url,
        };
      },
    });

    const summary = await poller.refreshAll();
    expect(summary).toMatchObject({
      skippedByFlag: false,
      polled: 2,
      notModified: 1,
      updated: 1,
      failed: 0,
      backedOff: 1,
      newEntries: 2,
      autoReadEntries: 1,
    });
    expect(seenHeaders.get("https://cached.example.com/rss.xml")).toMatchObject(
      {
        "If-None-Match": '"etag-v1"',
        "If-Modified-Since": "Wed, 01 Oct 2025 00:00:00 GMT",
        "User-Agent": "shepherdjerred-feeds/1.0",
      },
    );
    expect(notModifiedRecords).toHaveLength(1);
    expect(getPrunedCalls()).toBe(1);
  });
});

describe("createFeedsPoller backoff, single-flight, and autodiscovery", () => {
  test("honors 429 Retry-After, applies exponential backoff, and redacts query params in errors", async () => {
    const privateFeedUrl =
      "https://lwn.net/headlines/newrss?subscriber=fixture_value";
    const { store, failureRecords } = createFakeStore([
      makeFeed({
        id: 1,
        url: "https://rate.example.com/rss",
        consecutiveFailures: 0,
      }),
      makeFeed({
        id: 2,
        url: "https://flaky.example.com/rss",
        consecutiveFailures: 2,
      }),
      makeFeed({
        id: 3,
        url: privateFeedUrl,
        source: "user",
        consecutiveFailures: 0,
      }),
    ]);

    const poller = createFeedsPoller({
      store,
      nowSeconds: () => FIXED_NOW,
      fetchFeed: async (url: string): Promise<SafeFetchResult> => {
        if (url.includes("rate.example.com")) {
          return {
            status: 429,
            headers: new Headers({ "Retry-After": "1800" }),
            body: "Too Many Requests",
            finalUrl: url,
          };
        }
        if (url.includes("flaky.example.com")) {
          return {
            status: 503,
            headers: new Headers(),
            body: "Unavailable",
            finalUrl: url,
          };
        }
        throw new Error(`Socket reset while requesting ${url}`);
      },
    });

    const summary = await poller.refreshAll();
    expect(summary.failed).toBe(3);

    const rateFailure = failureRecords.find((r) => r.feedId === 1);
    expect(rateFailure?.nextPollAfterSeconds).toBe(FIXED_NOW + 1800);

    const expFailure = failureRecords.find((r) => r.feedId === 2);
    expect(expFailure?.nextPollAfterSeconds).toBe(FIXED_NOW + 1200);

    const secretFailure = failureRecords.find((r) => r.feedId === 3);
    expect(secretFailure?.errorMessage).not.toContain("fixture_value");
    expect(secretFailure?.errorMessage).toContain(
      "https://lwn.net/headlines/newrss?[REDACTED]",
    );
  });

  test("deduplicates concurrent refreshAll calls into a single flight", async () => {
    const { store } = createFakeStore([
      makeFeed({ id: 1, url: "https://slow.example.com/rss.xml" }),
    ]);
    let upstreamCalls = 0;
    let releaseFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const poller = createFeedsPoller({
      store,
      nowSeconds: () => FIXED_NOW,
      fetchFeed: async (url: string): Promise<SafeFetchResult> => {
        upstreamCalls += 1;
        await gate;
        return {
          status: 304,
          headers: new Headers(),
          body: "",
          finalUrl: url,
        };
      },
    });

    const first = poller.refreshAll();
    const second = poller.refreshAll();
    releaseFetch?.();
    const [r1, r2] = await Promise.all([first, second]);

    expect(upstreamCalls).toBe(1);
    expect(r1).toEqual(r2);
  });

  test("discoverAndSubscribe resolves HTML <link rel='alternate'> autodiscovery and records initial entries", async () => {
    const { store } = createFakeStore();
    const recordedEntries: ParsedFeedEntry[] = [];
    const origRecordSuccess = store.recordPollSuccess.bind(store);
    store.recordPollSuccess = async (input) => {
      recordedEntries.push(...input.entries);
      return await origRecordSuccess(input);
    };

    const poller = createFeedsPoller({
      store,
      nowSeconds: () => FIXED_NOW,
      fetchFeed: async (url: string): Promise<SafeFetchResult> => {
        if (url === "https://jvns.ca") {
          return {
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            body: `<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head></html>`,
            finalUrl: "https://jvns.ca/",
          };
        }
        return {
          status: 200,
          headers: new Headers({ etag: '"jvns-1"' }),
          body: `<feed xmlns="http://www.w3.org/2005/Atom">
            <title>Julia Evans</title>
            <link rel="alternate" href="https://jvns.ca/" />
            <entry><id>post-1</id><title>DNS Quirks</title><link href="https://jvns.ca/dns"/></entry>
          </feed>`,
          finalUrl: "https://jvns.ca/atom.xml",
        };
      },
    });

    const sub = await poller.discoverAndSubscribe({
      url: "https://jvns.ca",
      category: "Blogs",
    });
    expect(sub.ok).toBe(true);
    if (sub.ok) {
      expect(sub.feed.url).toBe("https://jvns.ca/atom.xml");
      expect(sub.feed.title).toBe("Julia Evans");
      expect(sub.feed.categoryLabel).toBe("Blogs");
      expect(sub.newEntries).toBe(1);
    }
    expect(recordedEntries).toHaveLength(1);
  });
});
