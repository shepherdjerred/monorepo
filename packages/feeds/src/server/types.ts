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
  readonly categories?: readonly string[] | undefined;
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

export type PollSuccessInput = {
  readonly feedId: number;
  readonly polledAtSeconds: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly discoveredHtmlUrl?: string | null | undefined;
  readonly entries: readonly ParsedFeedEntry[];
};

export type PollNotModifiedInput = {
  readonly feedId: number;
  readonly polledAtSeconds: number;
  readonly etag?: string | null | undefined;
  readonly lastModified?: string | null | undefined;
};

export type PollFailureInput = {
  readonly feedId: number;
  readonly polledAtSeconds: number;
  readonly status: number | null;
  readonly errorMessage: string;
  readonly nextPollAfterSeconds: number;
};

export type PruneOptions = {
  readonly maxReadPerFeed?: number | undefined;
  readonly minAgeSeconds?: number | undefined;
  readonly nowSeconds?: number | undefined;
};

export type ReaderSessionInput = {
  readonly tokenSha256: string;
  readonly username: string;
  readonly nowSeconds: number;
  readonly ttlSeconds: number;
};

export type EditEntryTagsInput = {
  readonly ids: readonly number[];
  readonly markRead?: boolean | undefined;
  readonly markStarred?: boolean | undefined;
};

export type FeedMutationResult =
  { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure;

export type OkMutationResult = { readonly ok: true } | StoreMutationFailure;

export type FeedsRepository = {
  close: () => Promise<void>;

  // Boot & maintenance
  reconcileCatalog: (feeds?: readonly DeclaredFeed[]) => Promise<{
    readonly upserted: number;
    readonly pruned: number;
  }>;
  pruneOldEntries: (options?: PruneOptions) => Promise<number>;

  // Poller reads & writes
  listFeedsForPoll: (nowSeconds: number) => Promise<readonly StoredFeed[]>;
  getFeedById: (id: number) => Promise<StoredFeed | undefined>;
  getFeedByUrl: (url: string) => Promise<StoredFeed | undefined>;
  recordPollNotModified: (input: PollNotModifiedInput) => Promise<void>;
  recordPollSuccess: (
    input: PollSuccessInput,
  ) => Promise<{ readonly inserted: number; readonly autoRead: number }>;
  recordPollFailure: (input: PollFailureInput) => Promise<void>;

  // Console queries & mutations
  summary: () => Promise<SummaryResponse>;
  listCategories: () => Promise<readonly CategorySummary[]>;
  listFeedsHealth: (
    redactUrl: (url: string, source: FeedSource) => string,
  ) => Promise<FeedsListResponse>;
  queryEntries: (query: ConsoleEntriesQuery) => Promise<EntriesResponse>;
  updateEntriesState: (body: UpdateEntriesStateBody) => Promise<number>;
  markAllRead: (body: MarkAllReadBody) => Promise<number>;
  createUserFeed: (body: CreateUserFeedBody) => Promise<FeedMutationResult>;
  updateUserFeed: (
    id: number,
    body: UpdateUserFeedBody,
  ) => Promise<FeedMutationResult>;
  deleteUserFeed: (id: number) => Promise<OkMutationResult>;

  // Reader API sessions & operations
  createReaderSession: (input: ReaderSessionInput) => Promise<void>;
  validateReaderSession: (
    tokenSha256: string,
    nowSeconds: number,
  ) => Promise<{ readonly username: string } | undefined>;
  subscriptionsEtag: () => Promise<string>;
  listAllFeeds: () => Promise<readonly StoredFeed[]>;
  listAllCategories: () => Promise<readonly StoredCategory[]>;
  queryReaderStreamIds: (
    query: ReaderStreamQuery,
  ) => Promise<ReaderStreamIdsPage>;
  getEntriesByIds: (ids: readonly number[]) => Promise<readonly StoredEntry[]>;
  editEntryTags: (input: EditEntryTagsInput) => Promise<number>;
  renameUserCategory: (
    oldLabel: string,
    newLabel: string,
  ) => Promise<OkMutationResult>;
  deleteUserCategory: (label: string) => Promise<OkMutationResult>;
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
