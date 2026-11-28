import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import {
  FeedSourceSchema,
  type AutoReadRule,
} from "@shepherdjerred/feeds/shared/contract.ts";
import { matchesAutoReadRule } from "@shepherdjerred/feeds/server/auto-read.ts";
import { parseSearchQuery } from "@shepherdjerred/feeds/server/search/search-tokens.ts";
import {
  hidesHiddenFeeds,
  parseAutoReadJson,
  parseCategoriesJson,
  parseEnclosuresJson,
  type WhereOptions,
} from "@shepherdjerred/feeds/server/store-shared.ts";
import type {
  StoredEntry,
  StoredFeed,
} from "@shepherdjerred/feeds/server/types.ts";

export type Sql = Prisma.Sql;
export type Db = PrismaClient | Prisma.TransactionClient;
export const sql = Prisma.sql;
export const join = Prisma.join;
export const empty = Prisma.empty;
export const raw = Prisma.raw;

export function createFeedsPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

/**
 * SQLite's `COLLATE NOCASE`: ASCII letters fold, every other byte compares
 * as is.
 */
export function nocase(expression: Sql): Sql {
  const upper = Array.from({ length: 26 }, (_unused, index) =>
    String.fromCodePoint(65 + index),
  ).join("");
  return sql`translate(${expression}, ${upper}, ${upper.toLowerCase()}) COLLATE "C"`;
}

/** A bigint column or aggregate as the number the contract speaks in. */
export function toNumber(value: bigint | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new TypeError(`Database integer out of safe range: ${String(value)}`);
  }
  return result;
}

export function toOptionalNumber(value: bigint | number | null): number | null {
  return value === null ? null : toNumber(value);
}

export type FeedRow = {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly categoryId: number;
  readonly categoryLabel: string;
  readonly htmlUrl: string | null;
  readonly description: string | null;
  readonly source: string;
  readonly hidden: boolean;
  readonly autoReadJson: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly lastPolledAt: bigint | null;
  readonly lastSuccessAt: bigint | null;
  readonly lastStatus: number | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly nextPollAfter: bigint | null;
};

export const FEED_COLUMNS = raw(
  `f.id, f.url, f.title, f.category_id AS "categoryId", c.label AS "categoryLabel", f.html_url AS "htmlUrl", f.description, f.source::text AS source, f.hidden, f.auto_read_json AS "autoReadJson", f.etag, f.last_modified AS "lastModified", f.last_polled_at AS "lastPolledAt", f.last_success_at AS "lastSuccessAt", f.last_status AS "lastStatus", f.last_error AS "lastError", f.consecutive_failures AS "consecutiveFailures", f.next_poll_after AS "nextPollAfter"`,
);
export const FEED_SELECT = sql`SELECT ${FEED_COLUMNS} FROM feeds f JOIN categories c ON c.id = f.category_id`;
/** Feeds in console order: managed categories first, then title. */
export const FEED_ORDER = sql`ORDER BY c.sort_order ASC, ${nocase(sql`f.title`)} ASC, f.id ASC`;

export function mapFeedRow(row: FeedRow): StoredFeed {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    categoryId: row.categoryId,
    categoryLabel: row.categoryLabel,
    htmlUrl: row.htmlUrl,
    description: row.description,
    source: FeedSourceSchema.parse(row.source),
    hidden: row.hidden,
    autoRead: parseAutoReadJson(row.autoReadJson),
    etag: row.etag,
    lastModified: row.lastModified,
    lastPolledAt: toOptionalNumber(row.lastPolledAt),
    lastSuccessAt: toOptionalNumber(row.lastSuccessAt),
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    nextPollAfter: toOptionalNumber(row.nextPollAfter),
  };
}

export type EntryRow = {
  readonly id: bigint;
  readonly feedId: number;
  readonly feedTitle: string;
  readonly categoryLabel: string;
  readonly feedHtmlUrl: string | null;
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly contentHtml: string;
  readonly publishedAt: bigint;
  readonly crawledAtMs: bigint;
  readonly enclosuresJson: string;
  readonly isRead: boolean;
  readonly isStarred: boolean;
  readonly autoReadMatched: boolean;
};

export const ENTRY_SELECT = sql`SELECT e.id, e.feed_id AS "feedId", f.title AS "feedTitle", c.label AS "categoryLabel", f.html_url AS "feedHtmlUrl", e.guid, e.url, e.title, e.author, e.content_html AS "contentHtml", e.published_at AS "publishedAt", e.crawled_at_ms AS "crawledAtMs", e.enclosures_json AS "enclosuresJson", e.is_read AS "isRead", e.is_starred AS "isStarred", e.auto_read_matched AS "autoReadMatched" FROM entries e JOIN feeds f ON f.id = e.feed_id JOIN categories c ON c.id = f.category_id`;
export const ENTRY_FROM = sql`FROM entries e JOIN feeds f ON f.id = e.feed_id JOIN categories c ON c.id = f.category_id`;

export function mapEntryRow(row: EntryRow): StoredEntry {
  return {
    id: toNumber(row.id),
    feedId: row.feedId,
    feedTitle: row.feedTitle,
    categoryLabel: row.categoryLabel,
    feedHtmlUrl: row.feedHtmlUrl,
    guid: row.guid,
    url: row.url,
    title: row.title,
    author: row.author,
    contentHtml: row.contentHtml,
    publishedAt: toNumber(row.publishedAt),
    crawledAtMs: toNumber(row.crawledAtMs),
    enclosures: parseEnclosuresJson(row.enclosuresJson),
    isRead: row.isRead,
    isStarred: row.isStarred,
    autoReadMatched: row.autoReadMatched,
  };
}

function scopeConditions(options: WhereOptions): Sql[] {
  const conds: Sql[] = [];
  if (options.unreadOnly === true || options.view === "unread") {
    conds.push(sql`NOT e.is_read`);
  }
  if (options.excludeStarred === true) {
    conds.push(sql`NOT e.is_starred`);
  }
  if (options.view === "starred") {
    conds.push(sql`e.is_starred`);
  } else if (options.view === "auto-read") {
    conds.push(sql`e.auto_read_matched`);
  }
  if (hidesHiddenFeeds(options)) {
    conds.push(sql`NOT f.hidden`);
  }
  if (options.category !== undefined) {
    conds.push(sql`c.label = ${options.category}`);
  }
  if (options.feedId !== undefined) {
    conds.push(sql`e.feed_id = ${options.feedId}`);
  }
  if (options.cursor !== undefined) {
    conds.push(sql`e.id < ${BigInt(options.cursor)}`);
  }
  if (options.beforeId !== undefined) {
    conds.push(sql`e.id <= ${BigInt(options.beforeId)}`);
  }
  if (options.publishedBefore !== undefined) {
    conds.push(sql`e.published_at < ${BigInt(options.publishedBefore)}`);
  }
  return conds;
}

/** The SQLite store's `buildEntryWhere`, with search on the tsvector. */
export function entryWhere(
  options: WhereOptions,
):
  | { readonly impossible: true }
  | { readonly impossible: false; readonly sql: Sql } {
  const conds = scopeConditions(options);
  if (options.q !== undefined) {
    const search = parseSearchQuery(options.q);
    if (search.kind === "nothing") {
      return { impossible: true };
    }
    if (search.kind === "match") {
      conds.push(sql`e.search_vector @@ ${search.tsquery}::tsquery`);
    }
  }
  return {
    impossible: false,
    sql: conds.length > 0 ? sql`WHERE ${join(conds, " AND ")}` : empty,
  };
}

export async function subscriptionsEtagFrom(db: Db): Promise<string> {
  const row = await db.meta.findUnique({
    where: { key: "subscriptions_etag" },
  });
  return row?.value ?? "1";
}

export async function bumpSubscriptionsEtag(db: Db): Promise<void> {
  const next = Number(await subscriptionsEtagFrom(db)) + 1;
  await db.meta.upsert({
    where: { key: "subscriptions_etag" },
    create: { key: "subscriptions_etag", value: String(next) },
    update: { value: String(next) },
  });
}

/**
 * Creates `label` if missing; a managed category also takes `sortOrder`, and
 * Uncategorized keeps its fixed order.
 */
export async function ensureCategory(
  db: Db,
  label: string,
  managed: boolean,
  sortOrder: number,
): Promise<{ readonly id: number; readonly changed: boolean }> {
  const inserted = await db.category.createMany({
    data: [{ label, managed, sortOrder }],
    skipDuplicates: true,
  });
  let changed = inserted.count > 0;
  if (managed) {
    const updated = await db.category.updateMany({
      where: {
        label,
        OR: [{ managed: false }, { sortOrder: { not: sortOrder } }],
      },
      data: { managed: true, sortOrder },
    });
    changed = changed || updated.count > 0;
  } else if (label === "Uncategorized") {
    const updated = await db.category.updateMany({
      where: { label, managed: false, sortOrder: { not: sortOrder } },
      data: { sortOrder },
    });
    changed = changed || updated.count > 0;
  }
  const row = await db.category.findUnique({
    where: { label },
    select: { id: true },
  });
  if (row === null) {
    throw new Error(`Failed to resolve category "${label}"`);
  }
  return { id: row.id, changed };
}

export async function getFeedById(
  db: Db,
  id: number,
): Promise<StoredFeed | undefined> {
  const rows = await db.$queryRaw<FeedRow[]>`${FEED_SELECT} WHERE f.id = ${id}`;
  const [row] = rows;
  return row === undefined ? undefined : mapFeedRow(row);
}

export async function getFeedByUrl(
  db: Db,
  url: string,
): Promise<StoredFeed | undefined> {
  const rows = await db.$queryRaw<
    FeedRow[]
  >`${FEED_SELECT} WHERE f.url = ${url}`;
  const [row] = rows;
  return row === undefined ? undefined : mapFeedRow(row);
}

/**
 * Marks a feed's unread, unstarred entries that match `rule` as auto-read.
 * Entries a reader starred or kept unread after an earlier sweep stay as
 * they are because only unread, unstarred rows are considered.
 */
export async function applyRetroactiveAutoRead(
  db: Db,
  feedId: number,
  rule: AutoReadRule | null | undefined,
): Promise<number> {
  if (rule === null || rule === undefined) {
    return 0;
  }
  const unread = await db.entry.findMany({
    where: { feedId, isRead: false, isStarred: false },
    select: { id: true, title: true, url: true, categoriesJson: true },
  });
  const matched = unread
    .filter((row) =>
      matchesAutoReadRule(rule, {
        title: row.title,
        url: row.url,
        categories: parseCategoriesJson(row.categoriesJson),
      }),
    )
    .map((row) => row.id);
  if (matched.length === 0) {
    return 0;
  }
  await db.entry.updateMany({
    where: { id: { in: matched } },
    data: { isRead: true, autoReadMatched: true },
  });
  return matched.length;
}
