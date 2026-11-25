import type { CreateUserFeedBody } from "@shepherdjerred/feeds/shared/contract.ts";
import type { FeedsRepository, StoredFeed } from "./types.ts";

export function buildStubUserFeedRecord(
  id: number,
  categoryId: number,
  body: CreateUserFeedBody,
): StoredFeed {
  return {
    id,
    url: body.url,
    title: body.title ?? body.url,
    categoryId,
    categoryLabel: body.category,
    htmlUrl: body.htmlUrl ?? null,
    description: null,
    source: "user",
    hidden: body.hidden,
    autoRead: body.autoRead ?? null,
    etag: null,
    lastModified: null,
    lastPolledAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastError: null,
    consecutiveFailures: 0,
    nextPollAfter: null,
  };
}

export function createNoopConsoleQueries(
  countFeeds: () => {
    readonly totalFeeds: number;
    readonly codeFeeds: number;
    readonly userFeeds: number;
  },
): Pick<
  FeedsRepository,
  | "summary"
  | "listCategories"
  | "listFeedsHealth"
  | "queryEntries"
  | "updateEntriesState"
  | "markAllRead"
> {
  return {
    summary: () => ({
      views: { unread: 0, all: 0, starred: 0, autoRead: 0 },
      categories: [],
      stats: {
        ...countFeeds(),
        failingFeeds: 0,
        lastPolledAt: null,
      },
    }),
    listCategories: () => [],
    listFeedsHealth: () => ({ feeds: [], categories: [] }),
    queryEntries: () => ({ items: [], totalMatching: 0, nextCursor: null }),
    updateEntriesState: () => 0,
    markAllRead: () => 0,
  };
}
