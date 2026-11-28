/**
 * Moves Feeds' data from its SQLite file into PostgreSQL. The copy runs in
 * one PostgreSQL transaction from one SQLite read snapshot and replaces
 * whatever PostgreSQL held, so it can be repeated until the cutover marker
 * is written. `verify-sqlite-import.ts` then proves the copy.
 */
import { Database } from "bun:sqlite";
import type { PrismaClient } from "#generated/prisma/client.ts";
import { FeedSourceSchema } from "@shepherdjerred/feeds/shared/contract.ts";
import { entrySearchDocument } from "@shepherdjerred/feeds/server/search/search-tokens.ts";
import { FeedsStore } from "@shepherdjerred/feeds/server/store.ts";

/** Written once the cutover import verified; PostgreSQL is then primary. */
export const STORAGE_CUTOVER_KEY = "storage_cutover";

const ENTRY_BATCH = 200;
const COPY_TRANSACTION = { maxWait: 60_000, timeout: 30 * 60_000 } as const;

export type FeedsTable =
  "meta" | "categories" | "feeds" | "entries" | "reader_sessions";

export const FEEDS_TABLES: readonly FeedsTable[] = [
  "meta",
  "categories",
  "feeds",
  "entries",
  "reader_sessions",
];

export type TableCounts = Readonly<Record<FeedsTable, number>>;

/** A read-only SQLite connection pinned to one snapshot of the file. */
export type SqliteSnapshot = {
  readonly db: Database;
  /** The SQLite store's own read paths over the same snapshot. */
  readonly store: FeedsStore;
  readonly release: () => void;
};

export function openSqliteSnapshot(path: string): SqliteSnapshot {
  const db = new Database(path, { readonly: true });
  db.run("BEGIN");
  // The first read fixes the WAL snapshot every later read sees.
  db.query("SELECT COUNT(*) FROM meta").get();
  return {
    db,
    store: FeedsStore.fromDatabase(db),
    release: () => {
      db.run("ROLLBACK");
      db.close();
    },
  };
}

export function countSqliteRows(db: Database): TableCounts {
  const count = (table: FeedsTable): number =>
    db
      .query<{ readonly n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`)
      .get()?.n ?? 0;
  return {
    meta: count("meta"),
    categories: count("categories"),
    feeds: count("feeds"),
    entries: count("entries"),
    reader_sessions: count("reader_sessions"),
  };
}

type SqliteMetaRow = { readonly key: string; readonly value: string };
type SqliteCategoryRow = {
  readonly id: number;
  readonly label: string;
  readonly managed: number;
  readonly sort_order: number;
};
type SqliteFeedRow = {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly category_id: number;
  readonly html_url: string | null;
  readonly description: string | null;
  readonly source: string;
  readonly hidden: number;
  readonly auto_read_json: string | null;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_polled_at: number | null;
  readonly last_success_at: number | null;
  readonly last_status: number | null;
  readonly last_error: string | null;
  readonly consecutive_failures: number;
  readonly next_poll_after: number | null;
};
type SqliteEntryRow = {
  readonly id: number;
  readonly feed_id: number;
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly content_html: string;
  readonly published_at: number;
  readonly crawled_at_ms: number;
  readonly enclosures_json: string;
  readonly categories_json: string;
  readonly is_read: number;
  readonly is_starred: number;
  readonly auto_read_matched: number;
};
type SqliteSessionRow = {
  readonly token_sha256: string;
  readonly username: string;
  readonly created_at: number;
  readonly expires_at: number;
};

function optionalBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}

/** AUTOINCREMENT high-water marks, so PostgreSQL never reuses a deleted ID. */
function sqliteSequence(db: Database, table: string): number {
  const exists = db
    .query<{ readonly n: number }, []>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_sequence'",
    )
    .get();
  return (exists?.n ?? 0) === 0
    ? 0
    : (db
        .query<{ readonly seq: number }, [string]>(
          "SELECT seq FROM sqlite_sequence WHERE name = ?",
        )
        .get(table)?.seq ?? 0);
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function copyEntries(db: Database, tx: Tx): Promise<number> {
  const page = db.query<SqliteEntryRow, [number, number]>(
    "SELECT * FROM entries WHERE id > ? ORDER BY id LIMIT ?",
  );
  let copied = 0;
  let after = 0;
  for (;;) {
    const rows = page.all(after, ENTRY_BATCH);
    const last = rows.at(-1);
    if (last === undefined) {
      return copied;
    }
    await tx.entry.createMany({
      data: rows.map((row) => ({
        id: BigInt(row.id),
        feedId: row.feed_id,
        guid: row.guid,
        url: row.url,
        title: row.title,
        author: row.author,
        contentHtml: row.content_html,
        publishedAt: BigInt(row.published_at),
        crawledAtMs: BigInt(row.crawled_at_ms),
        enclosuresJson: row.enclosures_json,
        categoriesJson: row.categories_json,
        isRead: row.is_read !== 0,
        isStarred: row.is_starred !== 0,
        autoReadMatched: row.auto_read_matched !== 0,
        searchDocument: entrySearchDocument(row.title, row.author),
      })),
    });
    copied += rows.length;
    after = last.id;
  }
}

async function copySubscriptions(db: Database, tx: Tx): Promise<void> {
  await tx.meta.createMany({
    data: db.query<SqliteMetaRow, []>("SELECT key, value FROM meta").all(),
  });
  await tx.category.createMany({
    data: db
      .query<SqliteCategoryRow, []>("SELECT * FROM categories ORDER BY id")
      .all()
      .map((row) => ({
        id: row.id,
        label: row.label,
        managed: row.managed !== 0,
        sortOrder: row.sort_order,
      })),
  });
  await tx.feed.createMany({
    data: db
      .query<SqliteFeedRow, []>("SELECT * FROM feeds ORDER BY id")
      .all()
      .map((row) => ({
        id: row.id,
        url: row.url,
        title: row.title,
        categoryId: row.category_id,
        htmlUrl: row.html_url,
        description: row.description,
        source: FeedSourceSchema.parse(row.source),
        hidden: row.hidden !== 0,
        autoReadJson: row.auto_read_json,
        etag: row.etag,
        lastModified: row.last_modified,
        lastPolledAt: optionalBigInt(row.last_polled_at),
        lastSuccessAt: optionalBigInt(row.last_success_at),
        lastStatus: row.last_status,
        lastError: row.last_error,
        consecutiveFailures: row.consecutive_failures,
        nextPollAfter: optionalBigInt(row.next_poll_after),
      })),
  });
}

async function advanceSequence(
  db: Database,
  tx: Tx,
  table: "categories" | "feeds",
): Promise<void> {
  const highWater = sqliteSequence(db, table);
  await tx.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), $1::int, 1), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), $1::int) > 0)`,
    highWater,
  );
}

/**
 * Replaces every Feeds row in PostgreSQL with the snapshot's rows, IDs
 * included, and returns how many rows each table received.
 */
export async function copySqliteToPostgres(
  snapshot: SqliteSnapshot,
  prisma: PrismaClient,
): Promise<TableCounts> {
  const { db } = snapshot;
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "TRUNCATE entries, feeds, categories, reader_sessions, meta RESTART IDENTITY CASCADE",
    );
    await copySubscriptions(db, tx);
    const entries = await copyEntries(db, tx);
    await tx.readerSession.createMany({
      data: db
        .query<SqliteSessionRow, []>("SELECT * FROM reader_sessions")
        .all()
        .map((row) => ({
          tokenSha256: row.token_sha256,
          username: row.username,
          createdAt: BigInt(row.created_at),
          expiresAt: BigInt(row.expires_at),
        })),
    });
    await advanceSequence(db, tx, "categories");
    await advanceSequence(db, tx, "feeds");
    const counts = countSqliteRows(db);
    if (counts.entries !== entries) {
      throw new Error(
        `Copied ${String(entries)} entries but the snapshot holds ${String(counts.entries)}`,
      );
    }
    return counts;
  }, COPY_TRANSACTION);
}

export async function readCutoverMarker(
  prisma: PrismaClient,
): Promise<string | undefined> {
  const row = await prisma.meta.findUnique({
    where: { key: STORAGE_CUTOVER_KEY },
  });
  return row?.value;
}

export async function writeCutoverMarker(
  prisma: PrismaClient,
  value: string,
): Promise<void> {
  await prisma.meta.create({ data: { key: STORAGE_CUTOVER_KEY, value } });
}
