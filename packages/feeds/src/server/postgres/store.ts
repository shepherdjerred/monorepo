import type { PrismaClient } from "#generated/prisma/client.ts";
import { DECLARED_FEEDS } from "@shepherdjerred/feeds/catalog/catalog.ts";
import type {
  CategorySummary,
  CreateUserFeedBody,
  DeclaredFeed,
  EntriesResponse,
  FeedSource,
  FeedsListResponse,
  MarkAllReadBody,
  SummaryResponse,
  UpdateEntriesStateBody,
  UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";
import { matchesAutoReadRule } from "@shepherdjerred/feeds/server/auto-read.ts";
import {
  createReaderSession,
  createUserFeed,
  deleteUserCategory,
  deleteUserFeed,
  renameUserCategory,
  updateUserFeed,
  validateReaderSession,
} from "./mutations.ts";
import {
  editEntryTags,
  getEntriesByIds,
  listAllCategories,
  listAllFeeds,
  listFeedsForPoll,
  markAllRead,
  queryCategories,
  queryConsoleEntries,
  queryFeedsHealth,
  queryReaderStreamIds,
  querySummary,
} from "./queries.ts";
import { reconcileCatalog } from "./reconcile.ts";
import {
  createFeedsPrismaClient,
  getFeedById,
  getFeedByUrl,
  subscriptionsEtagFrom,
  toNumber,
  type Db,
} from "./sql.ts";
import { entrySearchDocument } from "@shepherdjerred/feeds/server/search/search-tokens.ts";
import {
  DEFAULT_MAX_READ_PER_FEED,
  DEFAULT_PRUNE_MIN_AGE_SECONDS,
  orderPolledEntriesChronologically,
  STALE_POLL_ENTRY_MAX_AGE_SECONDS,
} from "@shepherdjerred/feeds/server/store-shared.ts";
import type {
  ConsoleEntriesQuery,
  EditEntryTagsInput,
  FeedMutationResult,
  FeedsRepository,
  OkMutationResult,
  ParsedFeedEntry,
  PollFailureInput,
  PollNotModifiedInput,
  PollSuccessInput,
  PruneOptions,
  ReaderSessionInput,
  ReaderStreamIdsPage,
  ReaderStreamQuery,
  StoredCategory,
  StoredEntry,
  StoredFeed,
} from "@shepherdjerred/feeds/server/types.ts";

/** A poll can write many entries; give its transaction room. */
const WRITE_TRANSACTION = { maxWait: 30_000, timeout: 120_000 } as const;

type PolledEntryState = {
  readonly id: bigint;
  readonly isRead: boolean;
  readonly isStarred: boolean;
  readonly autoReadMatched: boolean;
};

/**
 * Feeds' PostgreSQL store. It keeps the SQLite store's behaviour: every
 * write runs in its own transaction, one at a time in this process (SQLite
 * serialized writers too), and entry IDs come from the same in-process
 * microsecond allocator, so the newest entry always has the highest ID.
 */
export class PostgresFeedsStore implements FeedsRepository {
  #lastEntryId: number;
  #writes: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly prisma: PrismaClient,
    lastEntryId: number,
  ) {
    this.#lastEntryId = lastEntryId;
  }

  static async connect(databaseUrl: string): Promise<PostgresFeedsStore> {
    return await PostgresFeedsStore.fromClient(
      createFeedsPrismaClient(databaseUrl),
    );
  }

  static async fromClient(prisma: PrismaClient): Promise<PostgresFeedsStore> {
    const newest = await prisma.entry.aggregate({ _max: { id: true } });
    return new PostgresFeedsStore(prisma, toNumber(newest._max.id ?? 0n));
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  #allocateEntryId(nowMs: number): number {
    const next = Math.max(this.#lastEntryId + 1, nowMs * 1000);
    if (!Number.isSafeInteger(next) || next <= 0) {
      throw new Error(`Allocated entry id out of safe range: ${String(next)}`);
    }
    this.#lastEntryId = next;
    return next;
  }

  async #write<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    const previous = this.#writes;
    const { promise: done, resolve } = Promise.withResolvers<true>();
    this.#writes = done;
    try {
      await previous;
      return await this.prisma.$transaction(
        async (tx) => await work(tx),
        WRITE_TRANSACTION,
      );
    } finally {
      resolve(true);
    }
  }

  readonly #inTransaction = async <T>(
    work: (tx: Db) => Promise<T>,
  ): Promise<T> => await this.#write(work);

  async reconcileCatalog(
    feeds: readonly DeclaredFeed[] = DECLARED_FEEDS,
  ): Promise<{ readonly upserted: number; readonly pruned: number }> {
    return await this.#write(async (tx) => await reconcileCatalog(tx, feeds));
  }

  async pruneOldEntries(options?: PruneOptions): Promise<number> {
    const maxRead = options?.maxReadPerFeed ?? DEFAULT_MAX_READ_PER_FEED;
    const minAge = options?.minAgeSeconds ?? DEFAULT_PRUNE_MIN_AGE_SECONDS;
    const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    return await this.#write(
      async (tx) =>
        await tx.$executeRaw`
        DELETE FROM entries WHERE id IN (
          SELECT id FROM (
            SELECT id, published_at, ROW_NUMBER() OVER (
              PARTITION BY feed_id ORDER BY published_at DESC, id DESC
            ) AS rn
            FROM entries WHERE is_read AND NOT is_starred
          ) ranked
          WHERE rn > ${maxRead} AND published_at < ${BigInt(now - minAge)}
        )`,
    );
  }

  async listFeedsForPoll(nowSeconds: number): Promise<readonly StoredFeed[]> {
    return await listFeedsForPoll(this.prisma, nowSeconds);
  }

  async getFeedById(id: number): Promise<StoredFeed | undefined> {
    return await getFeedById(this.prisma, id);
  }

  async getFeedByUrl(url: string): Promise<StoredFeed | undefined> {
    return await getFeedByUrl(this.prisma, url);
  }

  async recordPollNotModified(input: PollNotModifiedInput): Promise<void> {
    await this.#write(async (tx) => {
      await tx.feed.updateMany({
        where: { id: input.feedId },
        data: {
          lastPolledAt: BigInt(input.polledAtSeconds),
          lastSuccessAt: BigInt(input.polledAtSeconds),
          lastStatus: 304,
          lastError: null,
          consecutiveFailures: 0,
          nextPollAfter: null,
          ...(input.etag === undefined || input.etag === null
            ? {}
            : { etag: input.etag }),
          ...(input.lastModified === undefined || input.lastModified === null
            ? {}
            : { lastModified: input.lastModified }),
        },
      });
    });
  }

  async recordPollSuccess(
    input: PollSuccessInput,
  ): Promise<{ readonly inserted: number; readonly autoRead: number }> {
    return await this.#write(async (tx) => {
      const feed = await getFeedById(tx, input.feedId);
      if (feed === undefined) {
        throw new Error(`Unknown feed id: ${String(input.feedId)}`);
      }
      const recorded = await this.#writePolledEntries(tx, feed, input);
      const discovered = input.discoveredHtmlUrl ?? "";
      await tx.feed.update({
        where: { id: input.feedId },
        data: {
          htmlUrl:
            discovered !== "" && feed.htmlUrl === null
              ? discovered
              : feed.htmlUrl,
          etag: input.etag,
          lastModified: input.lastModified,
          lastPolledAt: BigInt(input.polledAtSeconds),
          lastSuccessAt: BigInt(input.polledAtSeconds),
          lastStatus: 200,
          lastError: null,
          consecutiveFailures: 0,
          nextPollAfter: null,
        },
      });
      return recorded;
    });
  }

  async #writePolledEntries(
    tx: Db,
    feed: StoredFeed,
    input: PollSuccessInput,
  ): Promise<{ readonly inserted: number; readonly autoRead: number }> {
    const ordered = orderPolledEntriesChronologically(input.entries);
    const existingRows = await tx.entry.findMany({
      where: {
        feedId: feed.id,
        guid: { in: ordered.map((entry) => entry.guid) },
      },
      select: {
        id: true,
        guid: true,
        isRead: true,
        isStarred: true,
        autoReadMatched: true,
      },
    });
    const known = new Map<string, PolledEntryState>(
      existingRows.map(({ guid, ...state }) => [guid, state]),
    );
    const crawledAtMs = input.polledAtSeconds * 1000;
    const staleCutoffSeconds =
      feed.lastSuccessAt === null
        ? null
        : input.polledAtSeconds - STALE_POLL_ENTRY_MAX_AGE_SECONDS;
    let inserted = 0;
    let autoRead = 0;
    for (const entry of ordered) {
      const existing = known.get(entry.guid);
      const next =
        existing === undefined
          ? await this.#insertPolledEntry(tx, feed, entry, {
              crawledAtMs,
              staleCutoffSeconds,
            })
          : await updatePolledEntry(tx, feed, entry, existing);
      known.set(entry.guid, next.state);
      inserted += existing === undefined ? 1 : 0;
      autoRead += next.autoRead ? 1 : 0;
    }
    return { inserted, autoRead };
  }

  async #insertPolledEntry(
    tx: Db,
    feed: StoredFeed,
    entry: ParsedFeedEntry,
    timing: {
      readonly crawledAtMs: number;
      readonly staleCutoffSeconds: number | null;
    },
  ): Promise<{ readonly state: PolledEntryState; readonly autoRead: boolean }> {
    const matched = matchesAutoReadRule(feed.autoRead, entry);
    const staleArchive =
      timing.staleCutoffSeconds !== null &&
      entry.publishedAt < timing.staleCutoffSeconds;
    const state = {
      id: BigInt(this.#allocateEntryId(timing.crawledAtMs)),
      isRead: matched || staleArchive,
      isStarred: false,
      autoReadMatched: matched,
    };
    await tx.entry.create({
      data: {
        ...state,
        feedId: feed.id,
        guid: entry.guid,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        contentHtml: entry.contentHtml,
        publishedAt: BigInt(entry.publishedAt),
        crawledAtMs: BigInt(timing.crawledAtMs),
        enclosuresJson: JSON.stringify(entry.enclosures),
        categoriesJson: JSON.stringify(entry.categories ?? []),
        searchDocument: entrySearchDocument(entry.title, entry.author),
      },
    });
    return { state, autoRead: matched };
  }

  async recordPollFailure(input: PollFailureInput): Promise<void> {
    await this.#write(async (tx) => {
      await tx.feed.updateMany({
        where: { id: input.feedId },
        data: {
          lastPolledAt: BigInt(input.polledAtSeconds),
          lastStatus: input.status,
          lastError: input.errorMessage,
          consecutiveFailures: { increment: 1 },
          nextPollAfter: BigInt(input.nextPollAfterSeconds),
        },
      });
    });
  }

  async summary(): Promise<SummaryResponse> {
    return await querySummary(this.prisma);
  }

  async listCategories(): Promise<readonly CategorySummary[]> {
    return await queryCategories(this.prisma);
  }

  async listFeedsHealth(
    redactUrl: (url: string, source: FeedSource) => string,
  ): Promise<FeedsListResponse> {
    return await queryFeedsHealth(this.prisma, redactUrl);
  }

  async queryEntries(query: ConsoleEntriesQuery): Promise<EntriesResponse> {
    return await queryConsoleEntries(this.prisma, query);
  }

  async updateEntriesState(body: UpdateEntriesStateBody): Promise<number> {
    return await this.editEntryTags({
      ids: body.ids,
      markRead: body.isRead,
      markStarred: body.isStarred,
    });
  }

  async markAllRead(body: MarkAllReadBody): Promise<number> {
    return await this.#write(async (tx) => await markAllRead(tx, body));
  }

  async createUserFeed(body: CreateUserFeedBody): Promise<FeedMutationResult> {
    return await createUserFeed(this.#inTransaction, body);
  }

  async updateUserFeed(
    id: number,
    body: UpdateUserFeedBody,
  ): Promise<FeedMutationResult> {
    return await updateUserFeed(this.#inTransaction, id, body);
  }

  async deleteUserFeed(id: number): Promise<OkMutationResult> {
    return await deleteUserFeed(this.#inTransaction, id);
  }

  async createReaderSession(input: ReaderSessionInput): Promise<void> {
    await createReaderSession(this.#inTransaction, input);
  }

  async validateReaderSession(
    tokenSha256: string,
    nowSeconds: number,
  ): Promise<{ readonly username: string } | undefined> {
    return await validateReaderSession(this.prisma, tokenSha256, nowSeconds);
  }

  async subscriptionsEtag(): Promise<string> {
    return await subscriptionsEtagFrom(this.prisma);
  }

  async listAllFeeds(): Promise<readonly StoredFeed[]> {
    return await listAllFeeds(this.prisma);
  }

  async listAllCategories(): Promise<readonly StoredCategory[]> {
    return await listAllCategories(this.prisma);
  }

  async queryReaderStreamIds(
    query: ReaderStreamQuery,
  ): Promise<ReaderStreamIdsPage> {
    return await queryReaderStreamIds(this.prisma, query);
  }

  async getEntriesByIds(
    ids: readonly number[],
  ): Promise<readonly StoredEntry[]> {
    return await getEntriesByIds(this.prisma, ids);
  }

  async editEntryTags(input: EditEntryTagsInput): Promise<number> {
    return await this.#write(async (tx) => await editEntryTags(tx, input));
  }

  async renameUserCategory(
    oldLabel: string,
    newLabel: string,
  ): Promise<OkMutationResult> {
    return await renameUserCategory(this.#inTransaction, oldLabel, newLabel);
  }

  async deleteUserCategory(label: string): Promise<OkMutationResult> {
    return await deleteUserCategory(this.#inTransaction, label);
  }
}

/**
 * Refreshes a re-polled entry's content. A reader's read and star state is
 * kept, except that an untouched unread entry newly matching the feed's rule
 * becomes auto-read. Unchanged rows are not rewritten.
 */
async function updatePolledEntry(
  tx: Db,
  feed: StoredFeed,
  entry: ParsedFeedEntry,
  existing: PolledEntryState,
): Promise<{ readonly state: PolledEntryState; readonly autoRead: boolean }> {
  const newlyAutoRead =
    !existing.isRead &&
    !existing.isStarred &&
    !existing.autoReadMatched &&
    matchesAutoReadRule(feed.autoRead, entry);
  const enclosuresJson = JSON.stringify(entry.enclosures);
  const categoriesJson = JSON.stringify(entry.categories ?? []);
  await tx.entry.updateMany({
    where: {
      id: existing.id,
      OR: [
        { title: { not: entry.title } },
        { url: { not: entry.url } },
        { author: { not: entry.author } },
        { contentHtml: { not: entry.contentHtml } },
        { enclosuresJson: { not: enclosuresJson } },
        { categoriesJson: { not: categoriesJson } },
        ...(newlyAutoRead
          ? [{ isRead: false }, { autoReadMatched: false }]
          : []),
      ],
    },
    data: {
      title: entry.title,
      url: entry.url,
      author: entry.author,
      contentHtml: entry.contentHtml,
      enclosuresJson,
      categoriesJson,
      searchDocument: entrySearchDocument(entry.title, entry.author),
      ...(newlyAutoRead ? { isRead: true, autoReadMatched: true } : {}),
    },
  });
  return {
    state: newlyAutoRead
      ? { ...existing, isRead: true, autoReadMatched: true }
      : existing,
    autoRead: newlyAutoRead,
  };
}
