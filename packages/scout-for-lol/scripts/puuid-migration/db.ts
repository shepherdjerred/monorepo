/**
 * Dialect shims for the migration's database shapes.
 *
 * Live beta and prod are Postgres, driven through the generated Prisma client.
 * The long-running local harvest uses SQLite (`file:` URL, through bun:sqlite).
 * Every statement the migration issues is written to work on both.
 */

import {
  asCount,
  asOptionalString,
  asString,
  databaseUrl,
  type Row,
  type SqlParam,
  toRows,
} from "./support.ts";

export type Db = {
  readonly kind: "sqlite" | "postgres";
  /** Placeholder for the nth (1-based) bound parameter. */
  readonly param: (index: number) => string;
  /** Dialect-appropriate "now" expression. */
  readonly now: () => string;
  /** Dialect-appropriate nullable timestamp column type. */
  readonly timestampType: () => string;
  readonly query: (sql: string, params?: readonly SqlParam[]) => Promise<Row[]>;
  readonly exec: (sql: string, params?: readonly SqlParam[]) => Promise<void>;
  readonly transaction: (fn: () => Promise<void>) => Promise<void>;
  readonly listTables: () => Promise<string[]>;
  /** Every column, whatever its type. Timestamps are not text on either target. */
  readonly listColumns: (table: string) => Promise<string[]>;
  /** Text-ish columns only; PUUIDs are never stored numerically. */
  readonly listTextColumns: (table: string) => Promise<string[]>;
  readonly primaryKey: (table: string) => Promise<string[]>;
  readonly close: () => Promise<void>;
};

function isTextType(type: string): boolean {
  const upper = type.toUpperCase();
  return upper === "" || upper.includes("TEXT") || upper.includes("CHAR");
}

async function openSqlite(url: string): Promise<Db> {
  const { Database } = await import("bun:sqlite");
  const path = url.startsWith("file:") ? url.slice("file:".length) : url;
  // `create: false` is load-bearing. Bun's default would CREATE a database at a
  // mistyped or missing path, and every phase would then succeed against that
  // empty file — collect finding nothing, verify finding nothing to fault — so
  // an operator could retire the old key believing the real database had been
  // migrated. A wrong path has to fail here, loudly, not read as "no work to do".
  const db = new Database(path, { create: false, readwrite: true });
  db.run("PRAGMA journal_mode = WAL");

  const run = (sql: string, params: readonly SqlParam[]): Row[] =>
    toRows(db.prepare(sql).all(...params));

  return {
    kind: "sqlite",
    // Numbered (`?1`), never bare `?`. A bare placeholder binds by order of
    // APPEARANCE, so a statement using param(2) in SET and param(1) in WHERE
    // silently binds backwards and updates zero rows — which is exactly how the
    // first prod harvest/resolve run reported success while persisting nothing.
    // Postgres's `$1` is numbered already, so it never showed the problem.
    param: (index) => `?${index.toString()}`,
    // Millisecond resolution. `datetime('now')` truncates to whole seconds, and
    // the cutover marker is compared against account creation times recorded in
    // epoch milliseconds — an account created later in the marker's own second
    // would read as postdating a cutover it actually raced.
    now: () => "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    timestampType: () => "TEXT",
    query: (sql, params = []) => Promise.resolve(run(sql, params)),
    exec: (sql, params = []) => {
      db.prepare(sql).run(...params);
      return Promise.resolve();
    },
    transaction: async (fn) => {
      db.run("BEGIN");
      try {
        await fn();
        db.run("COMMIT");
      } catch (error) {
        db.run("ROLLBACK");
        throw error;
      }
    },
    listTables: () =>
      Promise.resolve(
        run("SELECT name FROM sqlite_master WHERE type = ?", ["table"])
          .map((r) => asString(r["name"], "table name"))
          .filter((n) => !n.startsWith("sqlite_")),
      ),
    listColumns: (table) =>
      Promise.resolve(
        run(`PRAGMA table_info("${table}")`, []).map((r) =>
          asString(r["name"], "column name"),
        ),
      ),
    listTextColumns: (table) =>
      Promise.resolve(
        run(`PRAGMA table_info("${table}")`, [])
          .filter((r) => isTextType(asOptionalString(r["type"]) ?? ""))
          .map((r) => asString(r["name"], "column name")),
      ),
    primaryKey: (table) =>
      Promise.resolve(
        run(`PRAGMA table_info("${table}")`, [])
          .filter((r) => asCount(r["pk"], "pk flag") > 0)
          .map((r) => asString(r["name"], "pk column")),
      ),
    close: () => {
      db.close();
      return Promise.resolve();
    },
  };
}

const COLUMN_CATALOG =
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1";

async function openPostgres(): Promise<Db> {
  const mod =
    await import("@scout-for-lol/backend/generated/prisma/client/index.js");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  // Prisma 7 requires an explicit driver adapter, matching how the backend
  // constructs its own client in src/database/index.ts.
  const prisma = new mod.PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl() }),
  });

  const query = async (
    sql: string,
    params: readonly SqlParam[],
  ): Promise<Row[]> => toRows(await prisma.$queryRawUnsafe(sql, ...params));

  return {
    kind: "postgres",
    param: (index) => `$${index.toString()}`,
    now: () => "now()",
    timestampType: () => "TIMESTAMPTZ",
    query: (sql, params = []) => query(sql, params),
    exec: async (sql, params = []) => {
      await prisma.$executeRawUnsafe(sql, ...params);
    },
    transaction: async (fn) => {
      // Prisma's interactive transaction cannot wrap raw calls made through the
      // outer client, so the phases rely on each statement being individually
      // durable and the whole run being resumable instead.
      await fn();
    },
    listTables: async () => {
      const rows = await query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
        [],
      );
      return rows.map((r) => asString(r["table_name"], "table name"));
    },
    listColumns: async (table) => {
      const rows = await query(COLUMN_CATALOG, [table]);
      return rows.map((r) => asString(r["column_name"], "column name"));
    },
    listTextColumns: async (table) => {
      const rows = await query(COLUMN_CATALOG, [table]);
      return rows
        .filter((r) => {
          const type = asOptionalString(r["data_type"]) ?? "";
          return type.includes("text") || type.includes("character");
        })
        .map((r) => asString(r["column_name"], "column name"));
    },
    primaryKey: async (table) => {
      const rows = await query(
        `SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = $1
            AND tc.constraint_type = 'PRIMARY KEY'
          ORDER BY kcu.ordinal_position`,
        [table],
      );
      return rows.map((r) => asString(r["column_name"], "pk column"));
    },
    close: async () => {
      await prisma.$disconnect();
    },
  };
}

export function openDb(): Promise<Db> {
  const url = databaseUrl();
  return url.startsWith("file:") ? openSqlite(url) : openPostgres();
}
