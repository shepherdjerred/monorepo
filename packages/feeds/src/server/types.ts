import type {
  AutoReadRule,
  CategorySummary,
  CreateUserFeedBody,
  DeclaredFeed,
  Enclosure,
  EntriesResponse,
  EntryView,
  FeedSource,
  FeedsListResponse,
  MarkAllReadBody,
  PollRunSummary,
  SummaryResponse,
  UpdateEntriesStateBody,
  UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";

export type StoredCategory = {
  readonly id: number;
  readonly label: string;
  readonly managed: boolean;
  readonly sortOrder: number;
};

export type StoredFeed = {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly categoryId: number;
  readonly categoryLabel: string;
  readonly htmlUrl: string | null;
  readonly description: string | null;
  readonly source: FeedSource;
  readonly hidden: boolean;
  readonly autoRead: AutoReadRule | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly lastPolledAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastStatus: number | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly nextPollAfter: number | null;
};

export type StoredEntry = {
  readonly id: number;
  readonly feedId: number;
  readonly feedTitle: string;
  readonly categoryLabel: string;
  readonly feedHtmlUrl: string | null;
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly contentHtml: string;
  readonly publishedAt: number;
  readonly crawledAtMs: number;
  readonly enclosures: readonly Enclosure[];
  readonly isRead: boolean;
  readonly isStarred: boolean;
  readonly autoReadMatched: boolean;
};

export type ParsedFeedEntry = {
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly contentHtml: string;
  readonly publishedAt: number;
  readonly enclosures: readonly Enclosure[];
};

export type ParsedFeedDocument = {
  readonly title: string;
  readonly htmlUrl: string | null;
  readonly description: string | null;
  readonly entries: readonly ParsedFeedEntry[];
};

export type ReaderStreamQuery = {
  /** 'reading-list' | 'starred' | { feedId: number } | { categoryLabel: string } */
  readonly stream:
    | { readonly kind: "reading-list" }
    | { readonly kind: "starred" }
    | { readonly kind: "feed"; readonly feedId: number }
    | { readonly kind: "category"; readonly label: string };
  readonly excludeRead: boolean;
  readonly minPublishedAt?: number | undefined;
  readonly limit: number;
  readonly cursor?: number | undefined;
};

export type ReaderStreamIdsPage = {
  readonly ids: readonly number[];
  readonly nextCursor?: number | undefined;
};

export type ConsoleEntriesQuery = {
  readonly view: EntryView;
  readonly category?: string | undefined;
  readonly feedId?: number | undefined;
  readonly q?: string | undefined;
  readonly cursor?: number | undefined;
  readonly limit?: number | undefined;
};

export type StoreMutationFailure =
  | { readonly ok: false; readonly kind: "not-found"; readonly message: string }
  | { readonly ok: false; readonly kind: "forbidden"; readonly message: string }
  | { readonly ok: false; readonly kind: "conflict"; readonly message: string }
  | { readonly ok: false; readonly kind: "invalid"; readonly message: string };

export type FeedsRepository = {
  close: () => void;

  // Boot & maintenance
  reconcileCatalog: (feeds?: readonly DeclaredFeed[]) => {
    readonly upserted: number;
    readonly pruned: number;
  };
  pruneOldEntries: (options?: {
    readonly maxReadPerFeed?: number | undefined;
    readonly minAgeSeconds?: number | undefined;
    readonly nowSeconds?: number | undefined;
  }) => number;

  // Poller reads & writes
  listFeedsForPoll: (nowSeconds: number) => readonly StoredFeed[];
  getFeedById: (id: number) => StoredFeed | undefined;
  getFeedByUrl: (url: string) => StoredFeed | undefined;
  recordPollNotModified: (input: {
    readonly feedId: number;
    readonly polledAtSeconds: number;
    readonly etag?: string | null | undefined;
    readonly lastModified?: string | null | undefined;
  }) => void;
  recordPollSuccess: (input: {
    readonly feedId: number;
    readonly polledAtSeconds: number;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly discoveredHtmlUrl?: string | null | undefined;
    readonly entries: readonly ParsedFeedEntry[];
  }) => { readonly inserted: number; readonly autoRead: number };
  recordPollFailure: (input: {
    readonly feedId: number;
    readonly polledAtSeconds: number;
    readonly status: number | null;
    readonly errorMessage: string;
    readonly nextPollAfterSeconds: number;
  }) => void;

  // Console queries & mutations
  summary: () => SummaryResponse;
  listCategories: () => readonly CategorySummary[];
  listFeedsHealth: (
    redactUrl: (url: string, source: FeedSource) => string,
  ) => FeedsListResponse;
  queryEntries: (query: ConsoleEntriesQuery) => EntriesResponse;
  updateEntriesState: (body: UpdateEntriesStateBody) => number;
  markAllRead: (body: MarkAllReadBody) => number;
  createUserFeed: (
    body: CreateUserFeedBody,
  ) => { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure;
  updateUserFeed: (
    id: number,
    body: UpdateUserFeedBody,
  ) => { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure;
  deleteUserFeed: (id: number) => { readonly ok: true } | StoreMutationFailure;

  // Reader API sessions & operations
  createReaderSession: (input: {
    readonly tokenSha256: string;
    readonly username: string;
    readonly nowSeconds: number;
    readonly ttlSeconds: number;
  }) => void;
  validateReaderSession: (
    tokenSha256: string,
    nowSeconds: number,
  ) => { readonly username: string } | undefined;
  subscriptionsEtag: () => string;
  listAllFeeds: () => readonly StoredFeed[];
  listAllCategories: () => readonly StoredCategory[];
  queryReaderStreamIds: (query: ReaderStreamQuery) => ReaderStreamIdsPage;
  getEntriesByIds: (ids: readonly number[]) => readonly StoredEntry[];
  editEntryTags: (input: {
    readonly ids: readonly number[];
    readonly markRead?: boolean | undefined;
    readonly markStarred?: boolean | undefined;
  }) => number;
  renameUserCategory: (
    oldLabel: string,
    newLabel: string,
  ) => { readonly ok: true } | StoreMutationFailure;
  deleteUserCategory: (
    label: string,
  ) => { readonly ok: true } | StoreMutationFailure;
};

export type FeedsPoller = {
  refreshAll: (options?: {
    readonly force?: boolean | undefined;
    readonly nowSeconds?: number | undefined;
  }) => Promise<PollRunSummary>;
  refreshFeed: (
    feedId: number,
    options?: { readonly nowSeconds?: number | undefined },
  ) => Promise<{
    readonly status: "updated" | "not-modified" | "failed";
    readonly newEntries: number;
    readonly error?: string | undefined;
  }>;
  discoverAndSubscribe: (input: {
    readonly url: string;
    readonly category?: string | undefined;
    readonly titleOverride?: string | undefined;
  }) => Promise<
    | {
        readonly ok: true;
        readonly feed: StoredFeed;
        readonly newEntries: number;
      }
    | StoreMutationFailure
  >;
};
