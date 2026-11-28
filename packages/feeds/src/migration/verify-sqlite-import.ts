/**
 * The cutover gates for the SQLite to PostgreSQL move, all from one SQLite
 * snapshot:
 *
 * 1. every table has the same rows (counts, then every column of every row);
 * 2. the app's own read paths (console summary, listings, Reader API
 *    streams, entry contents) return the same records from both stores;
 * 3. the same search terms return the same entries, and every entry's title
 *    and author tokenize exactly as FTS5 indexed them.
 *
 * Mismatches name the check and row IDs only, never feed URLs or content.
 */
import type { Database } from "bun:sqlite";
import type { PrismaClient } from "#generated/prisma/client.ts";
import type { EntryView } from "@shepherdjerred/feeds/shared/contract.ts";
import { searchTokens } from "@shepherdjerred/feeds/server/search/search-tokens.ts";
import type { FeedsRepository } from "@shepherdjerred/feeds/server/types.ts";
import {
  countSqliteRows,
  FEEDS_TABLES,
  STORAGE_CUTOVER_KEY,
  type FeedsTable,
  type SqliteSnapshot,
  type TableCounts,
} from "./sqlite-to-postgres.ts";

export type TableReport = {
  readonly table: FeedsTable;
  readonly sqlite: number;
  readonly postgres: number;
  readonly rowsEqual: boolean;
};

export type VerificationReport = {
  readonly ok: boolean;
  readonly tables: readonly TableReport[];
  readonly readPaths: {
    readonly checks: number;
    readonly mismatches: readonly string[];
  };
  readonly search: {
    readonly queries: number;
    readonly queriesWithMatches: number;
    readonly tokenizedFields: number;
    readonly mismatches: readonly string[];
  };
};

type TableSpec = {
  readonly table: FeedsTable;
  readonly key: string;
  readonly columns: readonly string[];
  readonly booleans: readonly string[];
};

const TABLE_SPECS: readonly TableSpec[] = [
  { table: "meta", key: "key", columns: ["key", "value"], booleans: [] },
  {
    table: "categories",
    key: "id",
    columns: ["id", "label", "managed", "sort_order"],
    booleans: ["managed"],
  },
  {
    table: "feeds",
    key: "id",
    columns: [
      "id",
      "url",
      "title",
      "category_id",
      "html_url",
      "description",
      "source",
      "hidden",
      "auto_read_json",
      "etag",
      "last_modified",
      "last_polled_at",
      "last_success_at",
      "last_status",
      "last_error",
      "consecutive_failures",
      "next_poll_after",
    ],
    booleans: ["hidden"],
  },
  {
    table: "entries",
    key: "id",
    columns: [
      "id",
      "feed_id",
      "guid",
      "url",
      "title",
      "author",
      "content_html",
      "published_at",
      "crawled_at_ms",
      "enclosures_json",
      "categories_json",
      "is_read",
      "is_starred",
      "auto_read_matched",
    ],
    booleans: ["is_read", "is_starred", "auto_read_matched"],
  },
  {
    table: "reader_sessions",
    key: "token_sha256",
    columns: ["token_sha256", "username", "created_at", "expires_at"],
    booleans: [],
  },
];

const ROW_BATCH = 500;

type Row = Record<string, unknown>;

function canonical(row: Row, spec: TableSpec): string {
  return JSON.stringify(
    spec.columns.map((column) => {
      const value = row[column];
      if (spec.booleans.includes(column)) {
        return value === true || value === 1;
      }
      return typeof value === "bigint" ? Number(value) : value;
    }),
  );
}

/** Keys of rows that differ (or exist on one side only), in key order. */
async function diffTable(
  sqlite: Database,
  prisma: PrismaClient,
  spec: TableSpec,
): Promise<readonly string[]> {
  const columns = spec.columns.join(", ");
  const pgColumns = spec.columns
    .map((column) => (column === "source" ? "source::text AS source" : column))
    .join(", ");
  // Text keys compare bytewise on both sides.
  const pgOrder = spec.key === "id" ? "id" : `${spec.key} COLLATE "C"`;
  const differing: string[] = [];
  for (let offset = 0; ; offset += ROW_BATCH) {
    const left = sqlite
      .query<Row, [number, number]>(
        `SELECT ${columns} FROM ${spec.table} ORDER BY ${spec.key} LIMIT ? OFFSET ?`,
      )
      .all(ROW_BATCH, offset);
    const right = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${pgColumns} FROM ${spec.table} ${spec.table === "meta" ? `WHERE key <> '${STORAGE_CUTOVER_KEY}'` : ""} ORDER BY ${pgOrder} LIMIT $1 OFFSET $2`,
      ROW_BATCH,
      offset,
    );
    if (left.length === 0 && right.length === 0) {
      return differing;
    }
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const a = left[i];
      const b = right[i];
      if (
        a === undefined ||
        b === undefined ||
        canonical(a, spec) !== canonical(b, spec)
      ) {
        differing.push(String((a ?? b)?.[spec.key]));
      }
    }
  }
}

async function countPostgresRows(prisma: PrismaClient): Promise<TableCounts> {
  const [meta, categories, feeds, entries, sessions] = await Promise.all([
    prisma.meta.count({ where: { key: { not: STORAGE_CUTOVER_KEY } } }),
    prisma.category.count(),
    prisma.feed.count(),
    prisma.entry.count(),
    prisma.readerSession.count(),
  ]);
  return {
    meta,
    categories,
    feeds,
    entries,
    reader_sessions: sessions,
  };
}

async function compareTables(
  snapshot: SqliteSnapshot,
  prisma: PrismaClient,
): Promise<readonly TableReport[]> {
  const left = countSqliteRows(snapshot.db);
  const right = await countPostgresRows(prisma);
  const reports: TableReport[] = [];
  for (const table of FEEDS_TABLES) {
    const spec = TABLE_SPECS.find((candidate) => candidate.table === table);
    if (spec === undefined) {
      throw new Error(`No comparison spec for ${table}`);
    }
    const differing = await diffTable(snapshot.db, prisma, spec);
    reports.push({
      table,
      sqlite: left[table],
      postgres: right[table],
      rowsEqual: differing.length === 0 && left[table] === right[table],
    });
  }
  return reports;
}

function identity(url: string): string {
  return url;
}

type ReadPathCheck = {
  readonly name: string;
  readonly read: (store: FeedsRepository) => Promise<unknown>;
};

const VIEWS: readonly EntryView[] = ["unread", "all", "starred", "auto-read"];

/** Deterministic sample: every `step`-th ID plus every starred entry. */
function sampleEntryIds(db: Database): number[] {
  const ids = db
    .query<{ readonly id: number; readonly is_starred: number }, []>(
      "SELECT id, is_starred FROM entries ORDER BY id",
    )
    .all();
  const step = Math.max(1, Math.floor(ids.length / 400));
  return ids
    .filter((row, index) => index % step === 0 || row.is_starred !== 0)
    .map((row) => row.id);
}

function readPathChecks(snapshot: SqliteSnapshot): readonly ReadPathCheck[] {
  const feeds = snapshot.store.listAllFeeds();
  const categories = snapshot.store.listAllCategories();
  const checks: ReadPathCheck[] = [
    { name: "summary", read: async (s) => await s.summary() },
    { name: "categories", read: async (s) => await s.listCategories() },
    {
      name: "feeds-health",
      read: async (s) => await s.listFeedsHealth(identity),
    },
    { name: "all-feeds", read: async (s) => await s.listAllFeeds() },
    { name: "all-categories", read: async (s) => await s.listAllCategories() },
    {
      name: "subscriptions-etag",
      read: async (s) => await s.subscriptionsEtag(),
    },
  ];
  const scopes: {
    readonly name: string;
    readonly category?: string;
    readonly feedId?: number;
  }[] = [
    { name: "all" },
    ...categories.map((c) => ({
      name: `category-${String(c.id)}`,
      category: c.label,
    })),
    ...feeds.map((f) => ({ name: `feed-${String(f.id)}`, feedId: f.id })),
  ];
  for (const view of VIEWS) {
    for (const scope of scopes) {
      checks.push({
        name: `entries-${view}-${scope.name}`,
        read: async (s) => {
          const first = await s.queryEntries({ view, ...scope, limit: 100 });
          const second =
            first.nextCursor === null
              ? null
              : await s.queryEntries({
                  view,
                  ...scope,
                  limit: 100,
                  cursor: first.nextCursor,
                });
          return { first, second };
        },
      });
    }
  }
  const streams = [
    { name: "reading-list", stream: { kind: "reading-list" } as const },
    { name: "starred", stream: { kind: "starred" } as const },
    ...feeds.map((f) => ({
      name: `feed-${String(f.id)}`,
      stream: { kind: "feed", feedId: f.id } as const,
    })),
    ...categories.map((c) => ({
      name: `category-${String(c.id)}`,
      stream: { kind: "category", label: c.label } as const,
    })),
  ];
  for (const { name, stream } of streams) {
    for (const excludeRead of [false, true]) {
      checks.push({
        name: `stream-${name}-${excludeRead ? "unread" : "all"}`,
        read: async (s) =>
          await s.queryReaderStreamIds({ stream, excludeRead, limit: 1000 }),
      });
    }
  }
  const sample = sampleEntryIds(snapshot.db);
  for (let offset = 0; offset < sample.length; offset += 100) {
    const ids = sample.slice(offset, offset + 100);
    checks.push({
      name: `entry-contents-${String(offset)}`,
      read: async (s) => await s.getEntriesByIds(ids),
    });
  }
  return checks;
}

async function compareReadPaths(
  sqlite: FeedsRepository,
  postgres: FeedsRepository,
  checks: readonly ReadPathCheck[],
): Promise<VerificationReport["readPaths"]> {
  const mismatches: string[] = [];
  for (const check of checks) {
    const [left, right] = await Promise.all([
      check.read(sqlite),
      check.read(postgres),
    ]);
    if (!Bun.deepEquals(left, right, true)) {
      mismatches.push(check.name);
    }
  }
  return { checks: checks.length, mismatches };
}

const FIXED_SEARCH_TERMS: readonly string[] = [
  "release",
  "v1.2",
  '"release notes"',
  "c++",
  "ai sdk",
  "+++",
  "_",
  "résumé",
  "rust",
  "postgres",
  "kubernetes",
  "security",
];

/** Search terms drawn from the data itself, plus a fixed set of edge cases. */
export function searchTermsFor(db: Database): readonly string[] {
  const rows = db
    .query<{ readonly title: string; readonly author: string }, []>(
      "SELECT title, author FROM entries ORDER BY id",
    )
    .all();
  const step = Math.max(1, Math.floor(rows.length / 150));
  const terms = new Set(FIXED_SEARCH_TERMS);
  rows.forEach((row, index) => {
    if (index % step !== 0) {
      return;
    }
    const words = row.title.match(/[\p{L}\p{N}_]+/gu) ?? [];
    const [first, second] = words;
    if (first !== undefined) {
      terms.add(first);
      terms.add(first.slice(0, 3));
    }
    if (first !== undefined && second !== undefined) {
      terms.add(`"${first} ${second}"`);
    }
    const authorWord = row.author.match(/[\p{L}\p{N}_]+/gu)?.at(-1);
    if (authorWord !== undefined) {
      terms.add(authorWord);
    }
  });
  return [...terms];
}

async function allMatchingIds(
  store: FeedsRepository,
  q: string,
): Promise<{ readonly total: number; readonly ids: readonly number[] }> {
  const ids: number[] = [];
  let cursor: number | undefined;
  let total = 0;
  for (;;) {
    const page = await store.queryEntries({
      view: "all",
      q,
      limit: 500,
      ...(cursor === undefined ? {} : { cursor }),
    });
    total = cursor === undefined ? page.totalMatching : total;
    ids.push(...page.items.map((item) => item.id));
    if (page.nextCursor === null) {
      return { total, ids };
    }
    cursor = page.nextCursor;
  }
}

/** Every entry's title and author tokens against FTS5's own index. */
function compareTokenization(db: Database): {
  readonly fields: number;
  readonly mismatches: readonly string[];
} {
  db.run(
    "CREATE VIRTUAL TABLE IF NOT EXISTS temp.feeds_import_terms USING fts5vocab(main, entries_fts, instance)",
  );
  const indexed = new Map<string, string[]>();
  for (const row of db
    .query<
      { readonly term: string; readonly doc: number; readonly col: string },
      []
    >(
      "SELECT term, doc, col FROM temp.feeds_import_terms ORDER BY doc, col, offset",
    )
    .all()) {
    const key = `${String(row.doc)}:${row.col}`;
    const terms = indexed.get(key) ?? [];
    terms.push(row.term);
    indexed.set(key, terms);
  }
  const mismatches: string[] = [];
  let fields = 0;
  for (const row of db
    .query<
      { readonly id: number; readonly title: string; readonly author: string },
      []
    >("SELECT id, title, author FROM entries")
    .all()) {
    for (const [col, text] of [
      ["title", row.title],
      ["author", row.author],
    ] as const) {
      fields += 1;
      const expected = indexed.get(`${String(row.id)}:${col}`) ?? [];
      if (JSON.stringify(expected) !== JSON.stringify(searchTokens(text))) {
        mismatches.push(`tokens-${String(row.id)}-${col}`);
      }
    }
  }
  return { fields, mismatches };
}

async function compareSearch(
  snapshot: SqliteSnapshot,
  sqlite: FeedsRepository,
  postgres: FeedsRepository,
): Promise<VerificationReport["search"]> {
  const tokenization = compareTokenization(snapshot.db);
  const terms = searchTermsFor(snapshot.db);
  const mismatches = [...tokenization.mismatches];
  let withMatches = 0;
  for (const [index, q] of terms.entries()) {
    const [left, right] = await Promise.all([
      allMatchingIds(sqlite, q),
      allMatchingIds(postgres, q),
    ]);
    if (!Bun.deepEquals(left, right, true)) {
      mismatches.push(`search-term-${String(index)}`);
    }
    withMatches += left.total > 0 ? 1 : 0;
  }
  return {
    queries: terms.length,
    queriesWithMatches: withMatches,
    tokenizedFields: tokenization.fields,
    mismatches,
  };
}

export async function verifySqliteImport(input: {
  readonly snapshot: SqliteSnapshot;
  readonly sqlite: FeedsRepository;
  readonly postgres: FeedsRepository;
  readonly prisma: PrismaClient;
}): Promise<VerificationReport> {
  const tables = await compareTables(input.snapshot, input.prisma);
  const readPaths = await compareReadPaths(
    input.sqlite,
    input.postgres,
    readPathChecks(input.snapshot),
  );
  const search = await compareSearch(
    input.snapshot,
    input.sqlite,
    input.postgres,
  );
  return {
    ok:
      tables.every((table) => table.rowsEqual) &&
      readPaths.mismatches.length === 0 &&
      search.mismatches.length === 0,
    tables,
    readPaths,
    search,
  };
}
