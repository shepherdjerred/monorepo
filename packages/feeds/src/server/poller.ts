import type { PollRunSummary } from "@shepherdjerred/feeds/shared/contract.ts";
import { discoverFeedUrlFromHtml, parseFeedXml } from "./parser.ts";
import {
  safeFetch,
  sanitizeErrorMessage,
  type SafeFetchResult,
} from "./ssrf.ts";
import type {
  FeedsPoller,
  FeedsRepository,
  ParsedFeedDocument,
  StoredFeed,
  StoreMutationFailure,
} from "./types.ts";

export type CreateFeedsPollerDeps = {
  readonly store: FeedsRepository;
  readonly shouldRefresh?: (() => Promise<boolean>) | undefined;
  readonly concurrency?: number | undefined;
  readonly fetchFeed?: typeof safeFetch | undefined;
  readonly nowSeconds?: (() => number) | undefined;
};

const POLL_ACCEPT_HEADER =
  "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1";
const DISCOVER_ACCEPT_HEADER =
  "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.1";
const USER_AGENT = "shepherdjerred-feeds/1.0";
const DEFAULT_CONCURRENCY = 8;
const BASE_BACKOFF_SECONDS = 300;
const MAX_EXP_BACKOFF_SECONDS = 21_600;
const MAX_RETRY_AFTER_SECONDS = 86_400;

type SingleFeedPollResult = {
  readonly status: "updated" | "not-modified" | "failed";
  readonly newEntries: number;
  readonly autoReadEntries: number;
  readonly error?: string | undefined;
};

function computeNextPollAfterSeconds(
  now: number,
  failureIndex: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader !== null) {
    const trimmed = retryAfterHeader.trim();
    if (/^\d+$/u.test(trimmed)) {
      const parsedSeconds = Number.parseInt(trimmed, 10);
      if (Number.isSafeInteger(parsedSeconds) && parsedSeconds > 0) {
        return now + Math.min(MAX_RETRY_AFTER_SECONDS, parsedSeconds);
      }
    } else if (trimmed.length > 0) {
      const dateMs = Date.parse(trimmed);
      if (!Number.isNaN(dateMs)) {
        const deltaSeconds = Math.ceil((dateMs - now * 1000) / 1000);
        if (deltaSeconds > 0) {
          return now + Math.min(MAX_RETRY_AFTER_SECONDS, deltaSeconds);
        }
      }
    }
  }
  const clampedExp = Math.min(Math.max(0, failureIndex), 10);
  const delay = Math.min(
    MAX_EXP_BACKOFF_SECONDS,
    BASE_BACKOFF_SECONDS * 2 ** clampedExp,
  );
  return now + delay;
}

function buildPollHeaders(feed: StoredFeed): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: POLL_ACCEPT_HEADER,
    "User-Agent": USER_AGENT,
  };
  if (feed.etag !== null && feed.etag.length > 0) {
    headers["If-None-Match"] = feed.etag;
  }
  if (feed.lastModified !== null && feed.lastModified.length > 0) {
    headers["If-Modified-Since"] = feed.lastModified;
  }
  return headers;
}

async function pollOneFeed(options: {
  readonly store: FeedsRepository;
  readonly fetchFeed: typeof safeFetch;
  readonly feed: StoredFeed;
  readonly now: number;
}): Promise<SingleFeedPollResult> {
  const { store, fetchFeed, feed, now } = options;
  let response: SafeFetchResult;
  try {
    response = await fetchFeed(feed.url, { headers: buildPollHeaders(feed) });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeError = sanitizeErrorMessage(rawMessage, feed.url);
    const nextPollAfterSeconds = computeNextPollAfterSeconds(
      now,
      feed.consecutiveFailures,
      null,
    );
    store.recordPollFailure({
      feedId: feed.id,
      polledAtSeconds: now,
      status: null,
      errorMessage: safeError,
      nextPollAfterSeconds,
    });
    return {
      status: "failed",
      newEntries: 0,
      autoReadEntries: 0,
      error: safeError,
    };
  }

  if (response.status === 304) {
    store.recordPollNotModified({
      feedId: feed.id,
      polledAtSeconds: now,
      etag: response.headers.get("etag") ?? feed.etag,
      lastModified: response.headers.get("last-modified") ?? feed.lastModified,
    });
    return { status: "not-modified", newEntries: 0, autoReadEntries: 0 };
  }

  if (response.status !== 200) {
    const safeError = sanitizeErrorMessage(
      `HTTP ${String(response.status)}`,
      feed.url,
    );
    const nextPollAfterSeconds = computeNextPollAfterSeconds(
      now,
      feed.consecutiveFailures,
      response.headers.get("retry-after"),
    );
    store.recordPollFailure({
      feedId: feed.id,
      polledAtSeconds: now,
      status: response.status,
      errorMessage: safeError,
      nextPollAfterSeconds,
    });
    return {
      status: "failed",
      newEntries: 0,
      autoReadEntries: 0,
      error: safeError,
    };
  }

  let parsed: ParsedFeedDocument;
  try {
    parsed = parseFeedXml(response.body, response.finalUrl, now);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeError = sanitizeErrorMessage(rawMessage, feed.url);
    const nextPollAfterSeconds = computeNextPollAfterSeconds(
      now,
      feed.consecutiveFailures,
      null,
    );
    store.recordPollFailure({
      feedId: feed.id,
      polledAtSeconds: now,
      status: response.status,
      errorMessage: safeError,
      nextPollAfterSeconds,
    });
    return {
      status: "failed",
      newEntries: 0,
      autoReadEntries: 0,
      error: safeError,
    };
  }

  const recorded = store.recordPollSuccess({
    feedId: feed.id,
    polledAtSeconds: now,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    discoveredHtmlUrl: parsed.htmlUrl,
    entries: parsed.entries,
  });

  return {
    status: "updated",
    newEntries: recorded.inserted,
    autoReadEntries: recorded.autoRead,
  };
}

type DiscoveredFeedPayload = {
  readonly feedUrl: string;
  readonly parsed: ParsedFeedDocument;
  readonly etag: string | null;
  readonly lastModified: string | null;
};

async function fetchAndResolveFeedDocument(
  url: string,
  fetchFeed: typeof safeFetch,
  now: number,
): Promise<
  | { readonly ok: true; readonly data: DiscoveredFeedPayload }
  | StoreMutationFailure
> {
  let initial: SafeFetchResult;
  try {
    initial = await fetchFeed(url, {
      headers: { Accept: DISCOVER_ACCEPT_HEADER, "User-Agent": USER_AGENT },
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: "invalid",
      message: sanitizeErrorMessage(rawMessage, url),
    };
  }

  if (initial.status < 200 || initial.status >= 300) {
    return {
      ok: false,
      kind: "invalid",
      message: sanitizeErrorMessage(
        `Upstream returned HTTP ${String(initial.status)}`,
        url,
      ),
    };
  }

  try {
    const parsed = parseFeedXml(initial.body, initial.finalUrl, now);
    return {
      ok: true,
      data: {
        feedUrl: initial.finalUrl,
        parsed,
        etag: initial.headers.get("etag"),
        lastModified: initial.headers.get("last-modified"),
      },
    };
  } catch {
    // Fall through to HTML <link rel="alternate"> autodiscovery
  }

  const discoveredUrl = discoverFeedUrlFromHtml(initial.body, initial.finalUrl);
  if (discoveredUrl === undefined) {
    return {
      ok: false,
      kind: "invalid",
      message: "No RSS, Atom, or RDF feed found at URL",
    };
  }

  let second: SafeFetchResult;
  try {
    second = await fetchFeed(discoveredUrl, {
      headers: { Accept: POLL_ACCEPT_HEADER, "User-Agent": USER_AGENT },
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: "invalid",
      message: sanitizeErrorMessage(rawMessage, discoveredUrl),
    };
  }

  if (second.status < 200 || second.status >= 300) {
    return {
      ok: false,
      kind: "invalid",
      message: sanitizeErrorMessage(
        `Discovered feed returned HTTP ${String(second.status)}`,
        discoveredUrl,
      ),
    };
  }

  try {
    const parsed = parseFeedXml(second.body, second.finalUrl, now);
    return {
      ok: true,
      data: {
        feedUrl: second.finalUrl,
        parsed,
        etag: second.headers.get("etag"),
        lastModified: second.headers.get("last-modified"),
      },
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: "invalid",
      message: sanitizeErrorMessage(rawMessage, discoveredUrl),
    };
  }
}

export function createFeedsPoller(deps: CreateFeedsPollerDeps): FeedsPoller {
  const { store } = deps;
  const fetchFeed = deps.fetchFeed ?? safeFetch;
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const getNowSeconds =
    deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  let activeRefresh: Promise<PollRunSummary> | null = null;

  async function executeRefreshAll(options?: {
    readonly force?: boolean | undefined;
    readonly nowSeconds?: number | undefined;
  }): Promise<PollRunSummary> {
    const startedMs = Date.now();
    const now = options?.nowSeconds ?? getNowSeconds();

    if (deps.shouldRefresh !== undefined) {
      const enabled = await deps.shouldRefresh();
      if (!enabled) {
        return {
          skippedByFlag: true,
          polled: 0,
          notModified: 0,
          updated: 0,
          failed: 0,
          backedOff: 0,
          newEntries: 0,
          autoReadEntries: 0,
          durationMs: Math.max(0, Date.now() - startedMs),
        };
      }
    }

    const allFeeds = store.listAllFeeds();
    const feedsToPoll =
      options?.force === true ? allFeeds : store.listFeedsForPoll(now);
    const backedOff =
      options?.force === true
        ? 0
        : Math.max(0, allFeeds.length - feedsToPoll.length);

    let notModified = 0;
    let updated = 0;
    let failed = 0;
    let newEntries = 0;
    let autoReadEntries = 0;
    let nextIndex = 0;

    const workerCount = Math.min(concurrency, feedsToPoll.length);
    const workers = Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const feed = feedsToPoll[index];
        if (feed === undefined) {
          return;
        }
        const res = await pollOneFeed({ store, fetchFeed, feed, now });
        if (res.status === "not-modified") {
          notModified += 1;
        } else if (res.status === "updated") {
          updated += 1;
          newEntries += res.newEntries;
          autoReadEntries += res.autoReadEntries;
        } else {
          failed += 1;
        }
      }
    });

    await Promise.all(workers);
    store.pruneOldEntries({ nowSeconds: now });

    return {
      skippedByFlag: false,
      polled: feedsToPoll.length,
      notModified,
      updated,
      failed,
      backedOff,
      newEntries,
      autoReadEntries,
      durationMs: Math.max(0, Date.now() - startedMs),
    };
  }

  async function runSingleFlightRefresh(options?: {
    readonly force?: boolean | undefined;
    readonly nowSeconds?: number | undefined;
  }): Promise<PollRunSummary> {
    try {
      return await executeRefreshAll(options);
    } finally {
      activeRefresh = null;
    }
  }

  return {
    refreshAll(options) {
      if (activeRefresh !== null) {
        return activeRefresh;
      }
      const promise = runSingleFlightRefresh(options);
      activeRefresh = promise;
      return promise;
    },

    async refreshFeed(feedId, options) {
      const feed = store.getFeedById(feedId);
      if (feed === undefined) {
        return {
          status: "failed",
          newEntries: 0,
          error: `Feed ${String(feedId)} not found`,
        };
      }
      const now = options?.nowSeconds ?? getNowSeconds();
      const result = await pollOneFeed({ store, fetchFeed, feed, now });
      return {
        status: result.status,
        newEntries: result.newEntries,
        ...(result.error === undefined ? {} : { error: result.error }),
      };
    },

    async discoverAndSubscribe(input) {
      const now = getNowSeconds();
      const resolved = await fetchAndResolveFeedDocument(
        input.url,
        fetchFeed,
        now,
      );
      if (!resolved.ok) {
        return resolved;
      }

      const { feedUrl, parsed, etag, lastModified } = resolved.data;
      const trimmedTitle = input.titleOverride?.trim();
      const title =
        trimmedTitle !== undefined && trimmedTitle.length > 0
          ? trimmedTitle
          : parsed.title;
      const trimmedCategory = input.category?.trim();
      const category =
        trimmedCategory !== undefined && trimmedCategory.length > 0
          ? trimmedCategory
          : "Uncategorized";

      const created = store.createUserFeed({
        url: feedUrl,
        title,
        category,
        ...(parsed.htmlUrl === null ? {} : { htmlUrl: parsed.htmlUrl }),
        hidden: false,
      });
      if (!created.ok) {
        return created;
      }

      const recorded = store.recordPollSuccess({
        feedId: created.feed.id,
        polledAtSeconds: now,
        etag,
        lastModified,
        discoveredHtmlUrl: parsed.htmlUrl,
        entries: parsed.entries,
      });
      const currentFeed = store.getFeedById(created.feed.id) ?? created.feed;
      return {
        ok: true,
        feed: currentFeed,
        newEntries: recorded.inserted,
      };
    },
  };
}
