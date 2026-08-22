/**
 * One-shot import of the legacy SQLite database into Postgres.
 *
 * Runs from the container entrypoint after `prisma migrate deploy`, before
 * the app starts. Fail-closed decision table:
 *
 *   marker present                  → skip (idempotent restart)
 *   no marker, Postgres has data    → hard error (ambiguous state; the
 *                                     previous image is still deployable)
 *   no marker, no data, sqlite file → import everything in one transaction
 *   no marker, no data, no sqlite   → hard error unless the caller explicitly
 *                                     allows a fresh install
 *
 * The marker table lives outside the Prisma schema (migrate deploy does not
 * drift-check), and the marker row is the LAST statement inside the import
 * transaction: a crash anywhere leaves no rows and no marker.
 */
import { Database } from "bun:sqlite";
import { createLogger } from "#src/logger.ts";
import type {
  ImportModelSpec,
  ImportTx,
  SqliteRow,
} from "#src/database/legacy-import/convert.ts";
import { IMPORT_MODELS_PART_1 } from "#src/database/legacy-import/models-part-1.ts";
import { IMPORT_MODELS_PART_2 } from "#src/database/legacy-import/models-part-2.ts";
import { IMPORT_MODELS_PART_3 } from "#src/database/legacy-import/models-part-3.ts";

/**
 * Structural client requirement so both the plain PrismaClient (entrypoint
 * CLI) and the $extends-wrapped test client qualify.
 */
export type ImportClient = ImportTx & {
  $transaction: <T>(
    fn: (tx: ImportTx) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ) => Promise<T>;
};

const logger = createLogger("legacy-import");

/** FK-safe topological order (parts are contiguous segments of it). */
export const IMPORT_MODELS: ImportModelSpec[] = [
  ...IMPORT_MODELS_PART_1,
  ...IMPORT_MODELS_PART_2,
  ...IMPORT_MODELS_PART_3,
];

/** Non-empty in any real legacy database; cheap ambiguity probe. */
const SENTINEL_MODELS = new Set([
  "Player",
  "User",
  "GuildInstall",
  "BucksLedgerEntry",
]);

const MARKER_TABLE = "_legacy_sqlite_import";

async function ensureMarkerTable(prisma: ImportClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
       id integer PRIMARY KEY CHECK (id = 1),
       imported_at timestamptz NOT NULL DEFAULT now(),
       source text NOT NULL,
       source_size_bytes bigint,
       row_counts jsonb NOT NULL
     )`,
  );
}

async function markerPresent(prisma: ImportClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ source: string }[]>(
    `SELECT source FROM ${MARKER_TABLE} WHERE id = 1`,
  );
  return rows.length > 0;
}

async function postgresHasData(prisma: ImportClient): Promise<boolean> {
  for (const spec of IMPORT_MODELS) {
    if (!SENTINEL_MODELS.has(spec.model)) {
      continue;
    }
    if ((await spec.count(prisma)) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Parents before children for the self-referential ExploreMessage tree: a
 * chunked createMany checks the parentId FK per statement, so a child must
 * never land in an earlier chunk than its parent. (A single-statement insert
 * would tolerate any order; chunking makes order load-bearing.)
 */
function topoSortByParent(rows: SqliteRow[]): SqliteRow[] {
  const remaining = new Map<unknown, SqliteRow>(
    rows.map((row) => [row["id"], row]),
  );
  const sorted: SqliteRow[] = [];
  const placed = new Set<unknown>();
  while (remaining.size > 0) {
    let progressed = false;
    for (const [id, row] of remaining) {
      const parent = row["parentId"];
      if (parent === null || placed.has(parent) || !remaining.has(parent)) {
        sorted.push(row);
        placed.add(id);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      throw new Error("ExploreMessage parentId cycle detected");
    }
  }
  return sorted;
}

function readSqliteRows(db: Database, spec: ImportModelSpec): SqliteRow[] {
  const orderBy = spec.idColumns.map((column) => `"${column}"`).join(", ");
  const rows: unknown = db
    .query(`SELECT * FROM "${spec.model}" ORDER BY ${orderBy}`)
    .all();
  if (!Array.isArray(rows)) {
    throw new TypeError(`${spec.model}: unexpected sqlite result shape`);
  }
  return rows.map((row) => {
    if (row === null || typeof row !== "object") {
      throw new Error(`${spec.model}: unexpected sqlite row shape`);
    }
    return Object.fromEntries(Object.entries(row));
  });
}

async function resetSequences(tx: ImportTx): Promise<void> {
  for (const spec of IMPORT_MODELS) {
    if (!spec.resetIdSequence) {
      continue;
    }
    const [column] = spec.idColumns;
    if (column === undefined) {
      throw new Error(`${spec.model}: resetIdSequence without an id column`);
    }
    // Without this, the first post-cutover insert dies on a duplicate PK:
    // imported rows carry explicit ids, which never advance the sequence.
    await tx.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${spec.model}"', '${column}'),` +
        ` COALESCE((SELECT MAX("${column}") FROM "${spec.model}"), 0) + 1, false)`,
    );
  }
}

export type ImportSummary = {
  action: "skipped" | "imported" | "fresh";
  rowCounts: Record<string, number>;
};

export type ImportOptions = {
  prisma: ImportClient;
  sqlitePath: string;
  allowFreshInstall?: boolean;
};

export async function runImport(
  options: ImportOptions,
): Promise<ImportSummary> {
  const { prisma, sqlitePath, allowFreshInstall = false } = options;
  await ensureMarkerTable(prisma);

  if (await markerPresent(prisma)) {
    logger.info("Legacy import marker present — skipping");
    return { action: "skipped", rowCounts: {} };
  }

  if (await postgresHasData(prisma)) {
    throw new Error(
      "Postgres contains data but no import marker — ambiguous state, refusing to " +
        "import or start. Roll back to the previous image, or resolve by hand " +
        `(inspect the ${MARKER_TABLE} table and sentinel model counts).`,
    );
  }

  const sqliteFile = Bun.file(sqlitePath);
  if (sqliteFile.size === 0) {
    if (!allowFreshInstall) {
      throw new Error(
        `Legacy sqlite source ${sqlitePath} is missing or empty; refusing to record a fresh install. ` +
          "Pass --allow-fresh-install only for an explicitly empty deployment.",
      );
    }
    logger.info(`No legacy sqlite at ${sqlitePath} — recording fresh install`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${MARKER_TABLE} (id, source, source_size_bytes, row_counts)
       VALUES (1, 'none', 0, '{}'::jsonb)`,
    );
    return { action: "fresh", rowCounts: {} };
  }

  logger.info(
    `Importing legacy sqlite ${sqlitePath} (${sqliteFile.size.toString()} bytes)`,
  );
  const db = new Database(sqlitePath, { readonly: true, safeIntegers: true });
  try {
    const sourceRows = new Map<string, SqliteRow[]>();
    for (const spec of IMPORT_MODELS) {
      const rows = readSqliteRows(db, spec);
      sourceRows.set(
        spec.model,
        spec.model === "ExploreMessage" ? topoSortByParent(rows) : rows,
      );
    }

    const rowCounts: Record<string, number> = {};
    await prisma.$transaction(
      async (tx) => {
        for (const spec of IMPORT_MODELS) {
          const rows = sourceRows.get(spec.model) ?? [];
          rowCounts[spec.model] =
            rows.length === 0 ? 0 : await spec.insertRows(tx, rows);
        }
        // In-transaction verification BEFORE the marker: a mismatch aborts
        // with nothing committed.
        for (const spec of IMPORT_MODELS) {
          const expected = sourceRows.get(spec.model)?.length ?? 0;
          const actual = await spec.count(tx);
          if (actual !== expected) {
            throw new Error(
              `${spec.model}: imported ${actual.toString()} rows, source has ${expected.toString()}`,
            );
          }
        }
        await resetSequences(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO ${MARKER_TABLE} (id, source, source_size_bytes, row_counts)
           VALUES (1, $1, $2, $3::jsonb)`,
          sqlitePath,
          sqliteFile.size,
          JSON.stringify(rowCounts),
        );
      },
      { timeout: 600_000, maxWait: 60_000 },
    );

    for (const spec of IMPORT_MODELS) {
      logger.info(
        `  ${spec.model}: ${(rowCounts[spec.model] ?? 0).toString()} rows`,
      );
    }
    return { action: "imported", rowCounts };
  } finally {
    db.close();
  }
}

export type VerifyMismatch = {
  model: string;
  kind: "count" | "content";
  detail: string;
};

/**
 * Read-only comparison of an existing Postgres database against a sqlite
 * snapshot: per-model row counts, then PK-ordered content digests through
 * the same transforms the import used. Returns mismatches; empty = clean.
 */
export async function verifyImport(
  options: ImportOptions,
): Promise<VerifyMismatch[]> {
  const { prisma, sqlitePath } = options;
  const mismatches: VerifyMismatch[] = [];
  const db = new Database(sqlitePath, { readonly: true, safeIntegers: true });
  try {
    for (const spec of IMPORT_MODELS) {
      const sqliteRows = readSqliteRows(db, spec);
      const pgCount = await spec.count(prisma);
      if (pgCount !== sqliteRows.length) {
        mismatches.push({
          model: spec.model,
          kind: "count",
          detail: `sqlite ${sqliteRows.length.toString()} vs postgres ${pgCount.toString()}`,
        });
        continue;
      }
      const sqliteDigests = sqliteRows.map((row) => spec.digestSqliteRow(row));
      const pgDigests = await spec.fetchPgDigestRows(prisma);
      for (const [index, sqliteDigest] of sqliteDigests.entries()) {
        if (sqliteDigest !== pgDigests[index]) {
          mismatches.push({
            model: spec.model,
            kind: "content",
            detail:
              `row ${index.toString()} differs\n` +
              `    sqlite:   ${sqliteDigest}\n` +
              `    postgres: ${pgDigests[index] ?? ""}`,
          });
          break;
        }
      }
    }
  } finally {
    db.close();
  }
  return mismatches;
}

/**
 * Ledger invariant: every BucksAccount balance equals the sum of its ledger
 * deltas. Reported, never corrected — drift here is an importer bug.
 */
export async function verifyLedgerBalances(
  prisma: ImportClient,
): Promise<string[]> {
  const accounts = await prisma.bucksAccount.findMany({
    select: { id: true, balance: true },
  });
  const sums = await prisma.bucksLedgerEntry.groupBy({
    by: ["bucksAccountId"],
    _sum: { delta: true },
  });
  const byAccount = new Map(
    sums.map((entry) => [entry.bucksAccountId, entry._sum.delta ?? 0]),
  );
  const drift: string[] = [];
  for (const account of accounts) {
    const expected = byAccount.get(account.id) ?? 0;
    if (expected !== account.balance) {
      drift.push(
        `BucksAccount ${account.id.toString()}: balance ${account.balance.toString()} != ledger sum ${expected.toString()}`,
      );
    }
  }
  return drift;
}
