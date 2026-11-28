import type {
  CategorySummary,
  EntriesResponse,
  FeedSource,
  FeedsListResponse,
  MarkAllReadBody,
  SummaryResponse,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  ENTRY_FROM,
  ENTRY_SELECT,
  entryWhere,
  FEED_COLUMNS,
  FEED_ORDER,
  FEED_SELECT,
  join,
  mapEntryRow,
  mapFeedRow,
  nocase,
  sql,
  toNumber,
  toOptionalNumber,
  type Db,
  type EntryRow,
  type FeedRow,
  type Sql,
} from "./sql.ts";
import type {
  ConsoleEntriesQuery,
  EditEntryTagsInput,
  ReaderStreamIdsPage,
  ReaderStreamQuery,
  StoredCategory,
  StoredEntry,
  StoredFeed,
} from "@shepherdjerred/feeds/server/types.ts";

const CATEGORY_ORDER = sql`ORDER BY c.sort_order ASC, ${nocase(sql`c.label`)} ASC, c.id ASC`;

type CategorySummaryRow = {
  readonly id: number;
  readonly label: string;
  readonly managed: boolean;
  readonly feedCount: bigint;
  readonly unreadCount: bigint;
};

export async function queryCategories(
  db: Db,
): Promise<readonly CategorySummary[]> {
  const rows = await db.$queryRaw<CategorySummaryRow[]>`
    SELECT c.id, c.label, c.managed,
      COUNT(DISTINCT f.id) AS "feedCount",
      COUNT(e.id) FILTER (WHERE NOT e.is_read) AS "unreadCount"
    FROM categories c
    LEFT JOIN feeds f ON f.category_id = c.id
    LEFT JOIN entries e ON e.feed_id = f.id
    GROUP BY c.id ${CATEGORY_ORDER}`;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    managed: row.managed,
    unreadCount: toNumber(row.unreadCount),
    feedCount: toNumber(row.feedCount),
  }));
}

type ViewCountsRow = {
  readonly unread: bigint;
  readonly totalVisible: bigint;
  readonly starred: bigint;
  readonly autoRead: bigint;
};

type FeedStatsRow = {
  readonly totalFeeds: bigint;
  readonly codeFeeds: bigint;
  readonly userFeeds: bigint;
  readonly failingFeeds: bigint;
  readonly lastPolledAt: bigint | null;
};

export async function querySummary(db: Db): Promise<SummaryResponse> {
  const [views] = await db.$queryRaw<ViewCountsRow[]>`
    SELECT
      COUNT(*) FILTER (WHERE NOT e.is_read AND NOT f.hidden) AS unread,
      COUNT(*) FILTER (WHERE NOT f.hidden) AS "totalVisible",
      COUNT(*) FILTER (WHERE e.is_starred) AS starred,
      COUNT(*) FILTER (WHERE e.auto_read_matched) AS "autoRead"
    FROM entries e JOIN feeds f ON f.id = e.feed_id`;
  const [stats] = await db.$queryRaw<FeedStatsRow[]>`
    SELECT
      COUNT(*) AS "totalFeeds",
      COUNT(*) FILTER (WHERE source = 'code') AS "codeFeeds",
      COUNT(*) FILTER (WHERE source = 'user') AS "userFeeds",
      COUNT(*) FILTER (WHERE consecutive_failures > 0) AS "failingFeeds",
      MAX(last_polled_at) AS "lastPolledAt"
    FROM feeds`;
  return {
    views: {
      unread: toNumber(views?.unread ?? 0),
      all: toNumber(views?.totalVisible ?? 0),
      starred: toNumber(views?.starred ?? 0),
      autoRead: toNumber(views?.autoRead ?? 0),
    },
    categories: [...(await queryCategories(db))],
    stats: {
      totalFeeds: toNumber(stats?.totalFeeds ?? 0),
      codeFeeds: toNumber(stats?.codeFeeds ?? 0),
      userFeeds: toNumber(stats?.userFeeds ?? 0),
      failingFeeds: toNumber(stats?.failingFeeds ?? 0),
      lastPolledAt: toOptionalNumber(stats?.lastPolledAt ?? null),
    },
  };
}

export async function queryFeedsHealth(
  db: Db,
  redactUrl: (url: string, source: FeedSource) => string,
): Promise<FeedsListResponse> {
  const rows = await db.$queryRaw<
    (FeedRow & { readonly unreadCount: bigint })[]
  >`
    SELECT ${FEED_COLUMNS}, COUNT(e.id) FILTER (WHERE NOT e.is_read) AS "unreadCount"
    FROM feeds f
    JOIN categories c ON c.id = f.category_id
    LEFT JOIN entries e ON e.feed_id = f.id
    GROUP BY f.id, c.id ${FEED_ORDER}`;
  return {
    feeds: rows.map((row) => {
      const {
        categoryId: _categoryId,
        categoryLabel: category,
        url,
        ...feed
      } = mapFeedRow(row);
      return {
        ...feed,
        category,
        displayUrl: redactUrl(url, feed.source),
        unreadCount: toNumber(row.unreadCount),
      };
    }),
    categories: [...(await queryCategories(db))],
  };
}

export async function queryConsoleEntries(
  db: Db,
  query: ConsoleEntriesQuery,
): Promise<EntriesResponse> {
  const safeLimit = Math.max(1, Math.min(query.limit ?? 100, 500));
  const scope = {
    view: query.view,
    category: query.category,
    feedId: query.feedId,
    q: query.q,
  };
  const countClause = entryWhere(scope);
  const pageClause = entryWhere({ ...scope, cursor: query.cursor });
  if (countClause.impossible || pageClause.impossible) {
    return { items: [], totalMatching: 0, nextCursor: null };
  }
  const [count] = await db.$queryRaw<{ readonly count: bigint }[]>`
    SELECT COUNT(*) AS count ${ENTRY_FROM} ${countClause.sql}`;
  const rows = await db.$queryRaw<EntryRow[]>`
    ${ENTRY_SELECT} ${pageClause.sql} ORDER BY e.id DESC LIMIT ${safeLimit + 1}`;
  const hasMore = rows.length > safeLimit;
  const pageRows = (hasMore ? rows.slice(0, safeLimit) : rows).map((row) =>
    mapEntryRow(row),
  );
  const lastRow = pageRows.at(-1);
  return {
    items: pageRows.map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      author: entry.author,
      publishedAt: entry.publishedAt,
      crawledAtMs: entry.crawledAtMs,
      isRead: entry.isRead,
      isStarred: entry.isStarred,
      autoReadMatched: entry.autoReadMatched,
      feed: {
        id: entry.feedId,
        title: entry.feedTitle,
        category: entry.categoryLabel,
        htmlUrl: entry.feedHtmlUrl,
      },
    })),
    totalMatching: toNumber(count?.count ?? 0),
    nextCursor: hasMore && lastRow !== undefined ? lastRow.id : null,
  };
}

export async function markAllRead(
  db: Db,
  body: MarkAllReadBody,
): Promise<number> {
  const clause = entryWhere({
    view: body.view,
    category: body.category,
    feedId: body.feedId,
    q: body.q,
    beforeId: body.beforeId,
    publishedBefore: body.publishedBefore,
    includeHidden: body.includeHidden,
    excludeStarred: body.excludeStarred,
    unreadOnly: true,
  });
  if (clause.impossible) {
    return 0;
  }
  return await db.$executeRaw`
    UPDATE entries SET is_read = true
    WHERE id IN (SELECT e.id ${ENTRY_FROM} ${clause.sql})`;
}

export async function listFeedsForPoll(
  db: Db,
  nowSeconds: number,
): Promise<readonly StoredFeed[]> {
  const rows = await db.$queryRaw<FeedRow[]>`
    ${FEED_SELECT}
    WHERE f.next_poll_after IS NULL OR f.next_poll_after <= ${BigInt(nowSeconds)}
    ORDER BY COALESCE(f.last_polled_at, 0) ASC, f.id ASC`;
  return rows.map((row) => mapFeedRow(row));
}

export async function listAllFeeds(db: Db): Promise<readonly StoredFeed[]> {
  const rows = await db.$queryRaw<FeedRow[]>`${FEED_SELECT} ${FEED_ORDER}`;
  return rows.map((row) => mapFeedRow(row));
}

export async function listAllCategories(
  db: Db,
): Promise<readonly StoredCategory[]> {
  return await db.$queryRaw<StoredCategory[]>`
    SELECT c.id, c.label, c.managed, c.sort_order AS "sortOrder"
    FROM categories c ${CATEGORY_ORDER}`;
}

function streamConditions(query: ReaderStreamQuery): Sql[] {
  const conds: Sql[] = [];
  switch (query.stream.kind) {
    case "reading-list":
      conds.push(sql`NOT f.hidden`);
      break;
    case "starred":
      conds.push(sql`e.is_starred`);
      break;
    case "feed":
      conds.push(sql`e.feed_id = ${query.stream.feedId}`);
      break;
    case "category":
      conds.push(sql`c.label = ${query.stream.label}`);
      break;
  }
  if (query.excludeRead) {
    conds.push(sql`NOT e.is_read`);
  }
  if (query.minPublishedAt !== undefined) {
    conds.push(sql`e.published_at >= ${BigInt(query.minPublishedAt)}`);
  }
  if (query.cursor !== undefined) {
    conds.push(sql`e.id < ${BigInt(query.cursor)}`);
  }
  return conds;
}

export async function queryReaderStreamIds(
  db: Db,
  query: ReaderStreamQuery,
): Promise<ReaderStreamIdsPage> {
  const safeLimit = Math.max(1, Math.min(query.limit, 10_000));
  const rows = await db.$queryRaw<{ readonly id: bigint }[]>`
    SELECT e.id ${ENTRY_FROM}
    WHERE ${join(streamConditions(query), " AND ")}
    ORDER BY e.id DESC LIMIT ${safeLimit + 1}`;
  const hasMore = rows.length > safeLimit;
  const ids = (hasMore ? rows.slice(0, safeLimit) : rows).map((row) =>
    toNumber(row.id),
  );
  const nextCursor = ids.at(-1);
  return hasMore && nextCursor !== undefined ? { ids, nextCursor } : { ids };
}

export async function getEntriesByIds(
  db: Db,
  ids: readonly number[],
): Promise<readonly StoredEntry[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db.$queryRaw<EntryRow[]>`
    ${ENTRY_SELECT} WHERE e.id = ANY(${ids.map(BigInt)}::bigint[])`;
  const byId = new Map(
    rows.map((row) => {
      const entry = mapEntryRow(row);
      return [entry.id, entry] as const;
    }),
  );
  return ids.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });
}

export async function editEntryTags(
  db: Db,
  input: EditEntryTagsInput,
): Promise<number> {
  if (
    input.ids.length === 0 ||
    (input.markRead === undefined && input.markStarred === undefined)
  ) {
    return 0;
  }
  const result = await db.entry.updateMany({
    where: { id: { in: input.ids.map(BigInt) } },
    data: {
      ...(input.markRead === undefined ? {} : { isRead: input.markRead }),
      ...(input.markStarred === undefined
        ? {}
        : { isStarred: input.markStarred }),
    },
  });
  return result.count;
}
