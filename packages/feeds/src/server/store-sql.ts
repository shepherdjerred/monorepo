import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  AutoReadRuleSchema,
  EnclosureSchema,
  FeedSourceSchema,
  normalizeAutoReadRules,
  type AutoReadRule,
  type EntryView,
} from "@shepherdjerred/feeds/shared/contract.ts";
import { matchesAutoReadRule } from "./auto-read.ts";
import type { StoredEntry, StoredFeed, StoreMutationFailure } from "./types.ts";

export type SqlParam = string | number | null;
export type IdRow = { readonly id: number };
export type CategoryRow = {
  readonly id: number;
  readonly label: string;
  readonly managed: number;
  readonly sort_order: number;
};
export type CategorySummaryRow = CategoryRow & {
  readonly unread_count: number;
  readonly feed_count: number;
};
export type FeedRow = Omit<StoredFeed, "source" | "hidden" | "autoRead"> & {
  readonly source: string;
  readonly hidden: number;
  readonly autoReadJson: string | null;
};
export type FeedHealthRow = FeedRow & { readonly unreadCount: number };
export type EntryRow = Omit<
  StoredEntry,
  "enclosures" | "isRead" | "isStarred" | "autoReadMatched"
> & {
  readonly enclosuresJson: string;
  readonly isRead: number;
  readonly isStarred: number;
  readonly autoReadMatched: number;
};

export type WhereOptions = {
  readonly view: EntryView | undefined;
  readonly category: string | undefined;
  readonly feedId: number | undefined;
  readonly q: string | undefined;
  readonly cursor?: number | undefined;
  readonly beforeId?: number | undefined;
  readonly publishedBefore?: number | undefined;
  readonly includeHidden?: boolean | undefined;
  readonly excludeStarred?: boolean | undefined;
  readonly unreadOnly?: boolean | undefined;
};

const EnclosuresArraySchema = z.array(EnclosureSchema);
const CategoriesArraySchema = z.array(z.string());

export const SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "INSERT INTO meta (key, value) VALUES ('subscriptions_etag', '1') ON CONFLICT(key) DO NOTHING",
  "CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, managed INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 100)",
  "CREATE TABLE IF NOT EXISTS feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), html_url TEXT, description TEXT, source TEXT NOT NULL CHECK (source IN ('code', 'user')), hidden INTEGER NOT NULL DEFAULT 0, auto_read_json TEXT, etag TEXT, last_modified TEXT, last_polled_at INTEGER, last_success_at INTEGER, last_status INTEGER, last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0, next_poll_after INTEGER)",
  "CREATE INDEX IF NOT EXISTS idx_feeds_category_id ON feeds(category_id)",
  "CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', content_html TEXT NOT NULL DEFAULT '', published_at INTEGER NOT NULL, crawled_at_ms INTEGER NOT NULL, enclosures_json TEXT NOT NULL DEFAULT '[]', categories_json TEXT NOT NULL DEFAULT '[]', is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, auto_read_matched INTEGER NOT NULL DEFAULT 0, UNIQUE (feed_id, guid))",
  "CREATE INDEX IF NOT EXISTS idx_entries_feed_id_id ON entries(feed_id, id DESC); CREATE INDEX IF NOT EXISTS idx_entries_is_read_id ON entries(is_read, id DESC); CREATE INDEX IF NOT EXISTS idx_entries_is_starred_id ON entries(is_starred, id DESC); CREATE INDEX IF NOT EXISTS idx_entries_published_at ON entries(published_at DESC)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(title, author, content='entries', content_rowid='id', tokenize='unicode61')",
  "CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN INSERT INTO entries_fts(rowid, title, author) VALUES (new.id, new.title, new.author); END",
  "CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN INSERT INTO entries_fts(entries_fts, rowid, title, author) VALUES ('delete', old.id, old.title, old.author); END",
  "CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF id, title, author ON entries BEGIN INSERT INTO entries_fts(entries_fts, rowid, title, author) VALUES ('delete', old.id, old.title, old.author); INSERT INTO entries_fts(rowid, title, author) VALUES (new.id, new.title, new.author); END",
  "CREATE TABLE IF NOT EXISTS reader_sessions (token_sha256 TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
].join(";\n");

export function ensureSchemaMigrationsInDb(db: Database): void {
  const columns = db
    .query<{ readonly name: string }, []>("PRAGMA table_info(entries)")
    .all();
  if (!columns.some((col) => col.name === "categories_json")) {
    db.run(
      "ALTER TABLE entries ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
}

export const FEED_COLS = `f.id, f.url, f.title, f.category_id AS categoryId, c.label AS categoryLabel, f.html_url AS htmlUrl, f.description, f.source, f.hidden, f.auto_read_json AS autoReadJson, f.etag, f.last_modified AS lastModified, f.last_polled_at AS lastPolledAt, f.last_success_at AS lastSuccessAt, f.last_status AS lastStatus, f.last_error AS lastError, f.consecutive_failures AS consecutiveFailures, f.next_poll_after AS nextPollAfter`;
export const FEED_SELECT_SQL = `SELECT ${FEED_COLS} FROM feeds f JOIN categories c ON c.id = f.category_id`;
export const ENTRY_SELECT_SQL = `SELECT e.id, e.feed_id AS feedId, f.title AS feedTitle, c.label AS categoryLabel, f.html_url AS feedHtmlUrl, e.guid, e.url, e.title, e.author, e.content_html AS contentHtml, e.published_at AS publishedAt, e.crawled_at_ms AS crawledAtMs, e.enclosures_json AS enclosuresJson, e.is_read AS isRead, e.is_starred AS isStarred, e.auto_read_matched AS autoReadMatched FROM entries e JOIN feeds f ON f.id = e.feed_id JOIN categories c ON c.id = f.category_id`;

export function mapFeedRow(row: FeedRow): StoredFeed {
  const { autoReadJson, source, hidden, ...rest } = row;
  const autoRead =
    autoReadJson === null
      ? null
      : AutoReadRuleSchema.parse(JSON.parse(autoReadJson));
  return {
    ...rest,
    source: FeedSourceSchema.parse(source),
    hidden: hidden !== 0,
    autoRead,
  };
}

export function mapEntryRow(row: EntryRow): StoredEntry {
  const { enclosuresJson, isRead, isStarred, autoReadMatched, ...rest } = row;
  const enclosures = EnclosuresArraySchema.parse(JSON.parse(enclosuresJson));
  return {
    ...rest,
    enclosures,
    isRead: isRead !== 0,
    isStarred: isStarred !== 0,
    autoReadMatched: autoReadMatched !== 0,
  };
}

function parseEntryCategoriesJson(rawJson: string): readonly string[] {
  try {
    const parsed = CategoriesArraySchema.safeParse(JSON.parse(rawJson));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function applyRetroactiveAutoReadForFeedInDb(
  db: Database,
  feedId: number,
  rule: AutoReadRule | null | undefined,
): number {
  if (rule === null || rule === undefined) {
    return 0;
  }
  const unreadRows = db
    .query<
      {
        readonly id: number;
        readonly title: string;
        readonly url: string;
        readonly categories_json: string;
      },
      [number]
    >(
      "SELECT id, title, url, categories_json FROM entries WHERE feed_id = ? AND is_read = 0 AND is_starred = 0",
    )
    .all(feedId);
  if (unreadRows.length === 0) {
    return 0;
  }
  const markStmt = db.query(
    "UPDATE entries SET is_read = 1, auto_read_matched = 1 WHERE id = ?",
  );
  let matchedCount = 0;
  for (const row of unreadRows) {
    const categories = parseEntryCategoriesJson(row.categories_json);
    if (
      matchesAutoReadRule(rule, {
        title: row.title,
        url: row.url,
        categories,
      })
    ) {
      markStmt.run(row.id);
      matchedCount += 1;
    }
  }
  return matchedCount;
}

function sanitizeFtsQuery(raw: string): {
  readonly emptyInput: boolean;
  readonly ftsExpr: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { emptyInput: true, ftsExpr: null };
  }
  const clauses: string[] = [];
  const remainder = trimmed.replaceAll(
    /"([^"]*)"/gu,
    (_full, inner: string) => {
      const words = inner.match(/[\p{L}\p{N}_]+/gu) ?? [];
      if (words.length > 0) {
        clauses.push(`"${words.join(" ")}"`);
      }
      return " ";
    },
  );
  for (const token of remainder.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    clauses.push(`"${token}"*`);
  }
  return {
    emptyInput: false,
    ftsExpr: clauses.length > 0 ? clauses.join(" ") : null,
  };
}

export function validateHttpUrl(rawUrl: string): URL | StoreMutationFailure {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, kind: "invalid", message: "Invalid URL" };
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? parsed
    : { ok: false, kind: "invalid", message: "URL must use http or https" };
}

export function validateOptionalAutoRead(
  rule: AutoReadRule | null | undefined,
): StoreMutationFailure | null {
  if (rule === null || rule === undefined) {
    return null;
  }
  const rules = normalizeAutoReadRules(rule);
  if (rules.length === 0) {
    return { ok: false, kind: "invalid", message: "Empty auto-read rule list" };
  }
  for (const single of rules) {
    if (single.pattern.length === 0) {
      return { ok: false, kind: "invalid", message: "Invalid auto-read regex" };
    }
    try {
      new RegExp(single.pattern, single.flags).test("");
    } catch {
      return { ok: false, kind: "invalid", message: "Invalid auto-read regex" };
    }
  }
  return null;
}

function appendBooleanScopeConditions(
  conds: string[],
  options: WhereOptions,
): void {
  if (options.unreadOnly === true || options.view === "unread") {
    conds.push("e.is_read = 0");
  }
  if (options.excludeStarred === true) {
    conds.push("e.is_starred = 0");
  }
  if (options.view === "starred") {
    conds.push("e.is_starred = 1");
  } else if (options.view === "auto-read") {
    conds.push("e.auto_read_matched = 1");
  }
  const unscoped =
    options.feedId === undefined && options.category === undefined;
  const hidesStream =
    options.view === undefined ||
    options.view === "unread" ||
    options.view === "all";
  const hideUnscoped = options.includeHidden !== true;
  if (hidesStream && unscoped && hideUnscoped) {
    conds.push("f.hidden = 0");
  }
}

function appendScopeConditions(
  conds: string[],
  params: SqlParam[],
  options: WhereOptions,
): void {
  appendBooleanScopeConditions(conds, options);
  const keyed: readonly [string, SqlParam | undefined][] = [
    ["c.label = ?", options.category],
    ["e.feed_id = ?", options.feedId],
    ["e.id < ?", options.cursor],
    ["e.id <= ?", options.beforeId],
    ["e.published_at < ?", options.publishedBefore],
  ];
  for (const [sql, val] of keyed) {
    if (val !== undefined) {
      conds.push(sql);
      params.push(val);
    }
  }
}

export function buildEntryWhere(options: WhereOptions): {
  readonly impossible: boolean;
  readonly sql: string;
  readonly params: SqlParam[];
} {
  const conds: string[] = [];
  const params: SqlParam[] = [];
  appendScopeConditions(conds, params, options);
  if (options.q !== undefined) {
    const fts = sanitizeFtsQuery(options.q);
    if (!fts.emptyInput) {
      if (fts.ftsExpr === null) {
        return { impossible: true, sql: "WHERE 0", params: [] };
      }
      conds.push(
        "e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)",
      );
      params.push(fts.ftsExpr);
    }
  }
  return {
    impossible: false,
    sql: conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "",
    params,
  };
}

export function subscriptionsEtagFromDb(db: Database): string {
  return (
    db
      .query<{ readonly value: string }, []>(
        "SELECT value FROM meta WHERE key = 'subscriptions_etag'",
      )
      .get()?.value ?? "1"
  );
}

export function bumpSubscriptionsEtagInDb(db: Database): void {
  const next = Number(subscriptionsEtagFromDb(db)) + 1;
  db.query("UPDATE meta SET value = ? WHERE key = 'subscriptions_etag'").run(
    String(next),
  );
}

export function ensureCategoryInDb(
  db: Database,
  label: string,
  managed: 0 | 1,
  sortOrder: number,
): { readonly id: number; readonly changed: boolean } {
  const ins = db
    .query(
      "INSERT INTO categories (label, managed, sort_order) VALUES (?, ?, ?) ON CONFLICT(label) DO NOTHING",
    )
    .run(label, managed, sortOrder);
  let changed = ins.changes > 0;
  if (managed === 1) {
    const upd = db
      .query(
        "UPDATE categories SET managed = 1, sort_order = ? WHERE label = ? AND (managed != 1 OR sort_order != ?)",
      )
      .run(sortOrder, label, sortOrder);
    changed = changed || upd.changes > 0;
  } else if (label === "Uncategorized") {
    const upd = db
      .query(
        "UPDATE categories SET sort_order = ? WHERE label = 'Uncategorized' AND managed = 0 AND sort_order != ?",
      )
      .run(sortOrder, sortOrder);
    changed = changed || upd.changes > 0;
  }
  const row = db
    .query<IdRow, [string]>("SELECT id FROM categories WHERE label = ?")
    .get(label);
  if (row === null) {
    throw new Error(`Failed to resolve category "${label}"`);
  }
  return { id: row.id, changed };
}

export function getFeedByIdFromDb(
  db: Database,
  id: number,
): StoredFeed | undefined {
  const row = db
    .query<FeedRow, [number]>(`${FEED_SELECT_SQL} WHERE f.id = ?`)
    .get(id);
  return row === null ? undefined : mapFeedRow(row);
}

export function getFeedByUrlFromDb(
  db: Database,
  url: string,
): StoredFeed | undefined {
  const row = db
    .query<FeedRow, [string]>(`${FEED_SELECT_SQL} WHERE f.url = ?`)
    .get(url);
  return row === null ? undefined : mapFeedRow(row);
}
