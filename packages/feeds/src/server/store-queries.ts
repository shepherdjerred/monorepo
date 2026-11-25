import type { Database } from "bun:sqlite";
import type {
  CategorySummary,
  EntriesResponse,
  FeedSource,
  FeedsListResponse,
  MarkAllReadBody,
  SummaryResponse,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  buildEntryWhere,
  ENTRY_SELECT_SQL,
  FEED_COLS,
  FEED_SELECT_SQL,
  mapEntryRow,
  mapFeedRow,
  type CategoryRow,
  type CategorySummaryRow,
  type EntryRow,
  type FeedHealthRow,
  type FeedRow,
  type IdRow,
  type SqlParam,
} from "./store-sql.ts";
import type {
  ConsoleEntriesQuery,
  ReaderStreamIdsPage,
  ReaderStreamQuery,
  StoredCategory,
  StoredEntry,
  StoredFeed,
} from "./types.ts";

export function queryCategoriesFromDb(
  db: Database,
): readonly CategorySummary[] {
  return db
    .query<CategorySummaryRow, []>(
      `SELECT c.id, c.label, c.managed, c.sort_order, COUNT(DISTINCT f.id) AS feed_count, COALESCE(SUM(CASE WHEN e.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count FROM categories c LEFT JOIN feeds f ON f.category_id = c.id LEFT JOIN entries e ON e.feed_id = f.id GROUP BY c.id ORDER BY c.sort_order ASC, c.label COLLATE NOCASE ASC, c.id ASC`,
    )
    .all()
    .map((r) => ({
      id: r.id,
      label: r.label,
      managed: r.managed !== 0,
      unreadCount: r.unread_count,
      feedCount: r.feed_count,
    }));
}

export function querySummaryFromDb(db: Database): SummaryResponse {
  const v = db
    .query<
      {
        readonly unread: number;
        readonly total_visible: number;
        readonly starred: number;
        readonly auto_read: number;
      },
      []
    >(
      `SELECT COALESCE(SUM(CASE WHEN e.is_read = 0 AND f.hidden = 0 THEN 1 ELSE 0 END), 0) AS unread, COALESCE(SUM(CASE WHEN f.hidden = 0 THEN 1 ELSE 0 END), 0) AS total_visible, COALESCE(SUM(CASE WHEN e.is_starred = 1 THEN 1 ELSE 0 END), 0) AS starred, COALESCE(SUM(CASE WHEN e.auto_read_matched = 1 THEN 1 ELSE 0 END), 0) AS auto_read FROM entries e JOIN feeds f ON f.id = e.feed_id`,
    )
    .get();
  const s = db
    .query<
      {
        readonly total_feeds: number;
        readonly code_feeds: number;
        readonly user_feeds: number;
        readonly failing_feeds: number;
        readonly last_polled_at: number | null;
      },
      []
    >(
      `SELECT COUNT(*) AS total_feeds, COALESCE(SUM(CASE WHEN source = 'code' THEN 1 ELSE 0 END), 0) AS code_feeds, COALESCE(SUM(CASE WHEN source = 'user' THEN 1 ELSE 0 END), 0) AS user_feeds, COALESCE(SUM(CASE WHEN consecutive_failures > 0 THEN 1 ELSE 0 END), 0) AS failing_feeds, MAX(last_polled_at) AS last_polled_at FROM feeds`,
    )
    .get();
  return {
    views: {
      unread: v?.unread ?? 0,
      all: v?.total_visible ?? 0,
      starred: v?.starred ?? 0,
      autoRead: v?.auto_read ?? 0,
    },
    categories: [...queryCategoriesFromDb(db)],
    stats: {
      totalFeeds: s?.total_feeds ?? 0,
      codeFeeds: s?.code_feeds ?? 0,
      userFeeds: s?.user_feeds ?? 0,
      failingFeeds: s?.failing_feeds ?? 0,
      lastPolledAt: s?.last_polled_at ?? null,
    },
  };
}

export function queryFeedsHealthFromDb(
  db: Database,
  redactUrl: (url: string, source: FeedSource) => string,
): FeedsListResponse {
  const rows = db
    .query<FeedHealthRow, []>(
      `SELECT ${FEED_COLS}, COALESCE(SUM(CASE WHEN e.is_read = 0 THEN 1 ELSE 0 END), 0) AS unreadCount FROM feeds f JOIN categories c ON c.id = f.category_id LEFT JOIN entries e ON e.feed_id = f.id GROUP BY f.id ORDER BY c.sort_order ASC, f.title COLLATE NOCASE ASC, f.id ASC`,
    )
    .all();
  return {
    feeds: rows.map((row) => {
      const {
        categoryId: _cid,
        categoryLabel: category,
        url,
        ...m
      } = mapFeedRow(row);
      return {
        ...m,
        category,
        displayUrl: redactUrl(url, m.source),
        unreadCount: row.unreadCount,
      };
    }),
    categories: [...queryCategoriesFromDb(db)],
  };
}

export function queryConsoleEntriesFromDb(
  db: Database,
  query: ConsoleEntriesQuery,
): EntriesResponse {
  const safeLimit = Math.max(1, Math.min(query.limit ?? 100, 500));
  const countClause = buildEntryWhere({
    view: query.view,
    category: query.category,
    feedId: query.feedId,
    q: query.q,
  });
  if (countClause.impossible) {
    return { items: [], totalMatching: 0, nextCursor: null };
  }
  const countRow = db
    .query<{ readonly count: number }, SqlParam[]>(
      `SELECT COUNT(*) AS count FROM entries e JOIN feeds f ON f.id = e.feed_id JOIN categories c ON c.id = f.category_id ${countClause.sql}`,
    )
    .get(...countClause.params);
  const pageClause = buildEntryWhere({
    view: query.view,
    category: query.category,
    feedId: query.feedId,
    q: query.q,
    cursor: query.cursor,
  });
  const rows = db
    .query<EntryRow, SqlParam[]>(
      `${ENTRY_SELECT_SQL} ${pageClause.sql} ORDER BY e.id DESC LIMIT ?`,
    )
    .all(...pageClause.params, safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const lastRow = pageRows.at(-1);
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      author: r.author,
      publishedAt: r.publishedAt,
      crawledAtMs: r.crawledAtMs,
      isRead: r.isRead !== 0,
      isStarred: r.isStarred !== 0,
      autoReadMatched: r.autoReadMatched !== 0,
      feed: {
        id: r.feedId,
        title: r.feedTitle,
        category: r.categoryLabel,
        htmlUrl: r.feedHtmlUrl,
      },
    })),
    totalMatching: countRow?.count ?? 0,
    nextCursor: hasMore && lastRow !== undefined ? lastRow.id : null,
  };
}

export function markAllReadInDb(db: Database, body: MarkAllReadBody): number {
  const clause = buildEntryWhere({
    view: body.view,
    category: body.category,
    feedId: body.feedId,
    q: body.q,
    beforeId: body.beforeId,
    unreadOnly: true,
  });
  return clause.impossible
    ? 0
    : db
        .query(
          `UPDATE entries SET is_read = 1 WHERE id IN (SELECT e.id FROM entries e JOIN feeds f ON f.id = e.feed_id JOIN categories c ON c.id = f.category_id ${clause.sql})`,
        )
        .run(...clause.params).changes;
}

export function listAllFeedsFromDb(db: Database): readonly StoredFeed[] {
  return db
    .query<FeedRow, []>(
      `${FEED_SELECT_SQL} ORDER BY c.sort_order ASC, f.title COLLATE NOCASE ASC, f.id ASC`,
    )
    .all()
    .map((row) => mapFeedRow(row));
}

export function listAllCategoriesFromDb(
  db: Database,
): readonly StoredCategory[] {
  return db
    .query<CategoryRow, []>(
      "SELECT id, label, managed, sort_order FROM categories ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC",
    )
    .all()
    .map((r) => ({
      id: r.id,
      label: r.label,
      managed: r.managed !== 0,
      sortOrder: r.sort_order,
    }));
}

export function queryReaderStreamIdsFromDb(
  db: Database,
  query: ReaderStreamQuery,
): ReaderStreamIdsPage {
  const conds: string[] = [];
  const params: SqlParam[] = [];
  switch (query.stream.kind) {
    case "reading-list":
      conds.push("f.hidden = 0");
      break;
    case "starred":
      conds.push("e.is_starred = 1");
      break;
    case "feed":
      conds.push("e.feed_id = ?");
      params.push(query.stream.feedId);
      break;
    case "category":
      conds.push("c.label = ?");
      params.push(query.stream.label);
      break;
  }
  if (query.excludeRead) {
    conds.push("e.is_read = 0");
  }
  if (query.minPublishedAt !== undefined) {
    conds.push("e.published_at >= ?");
    params.push(query.minPublishedAt);
  }
  if (query.cursor !== undefined) {
    conds.push("e.id < ?");
    params.push(query.cursor);
  }
  const safeLimit = Math.max(1, Math.min(query.limit, 10_000));
  const whereSql = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db
    .query<IdRow, SqlParam[]>(
      `SELECT e.id FROM entries e JOIN feeds f ON f.id = e.feed_id JOIN categories c ON c.id = f.category_id ${whereSql} ORDER BY e.id DESC LIMIT ?`,
    )
    .all(...params, safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const ids = (hasMore ? rows.slice(0, safeLimit) : rows).map((r) => r.id);
  const nextCursor = ids.at(-1);
  return hasMore && nextCursor !== undefined ? { ids, nextCursor } : { ids };
}

export function getEntriesByIdsFromDb(
  db: Database,
  ids: readonly number[],
): readonly StoredEntry[] {
  if (ids.length === 0) {
    return [];
  }
  const byId = new Map<number, StoredEntry>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    const rows = db
      .query<EntryRow, number[]>(
        `${ENTRY_SELECT_SQL} WHERE e.id IN (${chunk.map(() => "?").join(", ")})`,
      )
      .all(...chunk);
    for (const row of rows) {
      byId.set(row.id, mapEntryRow(row));
    }
  }
  return ids.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });
}

export function editEntryTagsInDb(
  db: Database,
  input: {
    readonly ids: readonly number[];
    readonly markRead?: boolean | undefined;
    readonly markStarred?: boolean | undefined;
  },
): number {
  if (
    input.ids.length === 0 ||
    (input.markRead === undefined && input.markStarred === undefined)
  ) {
    return 0;
  }
  const sets: string[] = [];
  const setParams: number[] = [];
  if (input.markRead !== undefined) {
    sets.push("is_read = ?");
    setParams.push(input.markRead ? 1 : 0);
  }
  if (input.markStarred !== undefined) {
    sets.push("is_starred = ?");
    setParams.push(input.markStarred ? 1 : 0);
  }
  let updated = 0;
  for (let offset = 0; offset < input.ids.length; offset += 500) {
    const chunk = input.ids.slice(offset, offset + 500);
    updated += db
      .query(
        `UPDATE entries SET ${sets.join(", ")} WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      )
      .run(...setParams, ...chunk).changes;
  }
  return updated;
}
