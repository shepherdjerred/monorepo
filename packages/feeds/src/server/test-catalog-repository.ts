import { DECLARED_FEEDS } from "@shepherdjerred/feeds/catalog/catalog.ts";
import type { DeclaredFeed } from "@shepherdjerred/feeds/shared/contract.ts";
import { MANAGED_CATEGORY_ORDER } from "./store-shared.ts";
import {
  asyncFeedsRepository,
  type SyncFeedsRepository,
} from "./test-async-repository.ts";
import { createNoopConsoleQueries } from "./test-repo-stub.ts";
import type { FeedsRepository, StoredCategory, StoredFeed } from "./types.ts";

function declaredFeedRecord(
  id: number,
  feed: DeclaredFeed,
  categoryId: number,
): StoredFeed {
  return {
    id,
    url: feed.url,
    title: feed.title,
    categoryId,
    categoryLabel: feed.category,
    htmlUrl: feed.htmlUrl ?? null,
    description: feed.description ?? null,
    source: "code",
    hidden: feed.hidden === true,
    autoRead: feed.autoRead ?? null,
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

function unsupported(name: string): never {
  throw new Error(`${name} is not supported by the catalog test repository`);
}

/**
 * An in-memory repository holding only the code catalog and Reader sessions,
 * for HTTP-surface tests that do not need entry storage. Store behaviour is
 * covered against PostgreSQL by the store contract.
 */
export function createCatalogTestRepository(): FeedsRepository {
  const feeds = new Map<number, StoredFeed>();
  const sessions = new Map<string, { username: string; expiresAt: number }>();
  const categories: StoredCategory[] = MANAGED_CATEGORY_ORDER.map(
    (spec, index) => ({
      id: index + 1,
      label: spec.label,
      managed: true,
      sortOrder: spec.sortOrder,
    }),
  );
  const categoryId = (label: string): number =>
    categories.find((category) => category.label === label)?.id ?? 0;
  const counts = () => ({
    totalFeeds: feeds.size,
    codeFeeds: [...feeds.values()].filter((feed) => feed.source === "code")
      .length,
    userFeeds: [...feeds.values()].filter((feed) => feed.source === "user")
      .length,
  });
  const store: SyncFeedsRepository = {
    close: () => {
      feeds.clear();
    },
    reconcileCatalog: (declared: readonly DeclaredFeed[] = DECLARED_FEEDS) => {
      feeds.clear();
      declared.forEach((feed, index) => {
        feeds.set(
          index + 1,
          declaredFeedRecord(index + 1, feed, categoryId(feed.category)),
        );
      });
      return { upserted: declared.length, pruned: 0 };
    },
    pruneOldEntries: () => 0,
    listFeedsForPoll: () => [...feeds.values()],
    getFeedById: (id) => feeds.get(id),
    getFeedByUrl: (url) => [...feeds.values()].find((feed) => feed.url === url),
    recordPollNotModified: () => {
      /* entries are not stored */
    },
    recordPollSuccess: () => ({ inserted: 0, autoRead: 0 }),
    recordPollFailure: () => {
      /* entries are not stored */
    },
    ...createNoopConsoleQueries(counts),
    createUserFeed: () => unsupported("createUserFeed"),
    updateUserFeed: () => unsupported("updateUserFeed"),
    deleteUserFeed: () => unsupported("deleteUserFeed"),
    createReaderSession: (input) => {
      sessions.set(input.tokenSha256, {
        username: input.username,
        expiresAt: input.nowSeconds + input.ttlSeconds,
      });
    },
    validateReaderSession: (tokenSha256, nowSeconds) => {
      const session = sessions.get(tokenSha256);
      return session !== undefined && session.expiresAt > nowSeconds
        ? { username: session.username }
        : undefined;
    },
    subscriptionsEtag: () => "1",
    listAllFeeds: () => [...feeds.values()],
    listAllCategories: () => categories,
    queryReaderStreamIds: () => ({ ids: [] }),
    getEntriesByIds: () => [],
    editEntryTags: () => 0,
    renameUserCategory: () => unsupported("renameUserCategory"),
    deleteUserCategory: () => unsupported("deleteUserCategory"),
  };
  return asyncFeedsRepository(store);
}
