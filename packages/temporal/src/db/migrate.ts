/**
 * Hand-rolled migration runner for the pr_review_eval database. No ORM —
 * lists `.sql` files in lex order, applies each in a transaction, records
 * the file + sha256 checksum in the `_migrations` ledger so re-runs are no-ops.
 *
 * Migration checksums prevent silent drift: if a previously-applied file
 * changes on disk, the runner refuses to proceed rather than re-applying.
 *
 * Final destination for the runner activity is in the temporal worker boot
 * sequence; this module is callable both from the worker startup path and
 * from `scripts/run-migrations.ts` for local-dev migrations.
 *
 * Why Bun.SQL: native to the runtime, no extra dep, supports tagged-template
 * parameterization and `.unsafe()` for full-statement SQL with multiple
 * statements (DDL, transactions). See https://bun.sh/docs/api/sql.
 */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const MIGRATIONS_DIR = new URL("migrations/pr-review-eval", import.meta.url)
  .pathname;

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "pr-review-eval-migrator",
      ...fields,
    }),
  );
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

type LedgerRow = { filename: string; checksum: string };

/**
 * Apply all pending migrations in `MIGRATIONS_DIR` in lex order. Idempotent.
 *
 * Returns the list of files actually applied (in order). An empty array
 * means everything was already up to date.
 *
 * The caller owns connection-string sourcing — typically from 1Password
 * Connect via the OnePasswordItem CR on the temporal-worker chart.
 */
export async function runMigrations(
  connectionString: string,
): Promise<string[]> {
  const sql = new Bun.SQL(connectionString);
  try {
    return await runMigrationsWith(sql);
  } finally {
    await sql.close();
  }
}

async function runMigrationsWith(sql: Bun.SQL): Promise<string[]> {
  const applied: string[] = [];

  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries
    .filter((f) => f.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    jsonLog("warning", "No migration files found", {
      directory: MIGRATIONS_DIR,
    });
    return applied;
  }

  // The 000_init.sql migration CREATEs the _migrations table itself, so we
  // can't query the ledger first. Probe with information_schema; if the
  // table is missing we know we're on a fresh database and 000_init.sql
  // is the first thing to apply.
  const ledgerExists = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_migrations'
    ) AS exists
  `;
  const ledger: LedgerRow[] =
    ledgerExists[0]?.exists === true
      ? await sql<LedgerRow[]>`SELECT filename, checksum FROM _migrations`
      : [];
  const ledgerByFile = new Map(ledger.map((r) => [r.filename, r.checksum]));

  for (const filename of files) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const content = await readFile(filePath, "utf8");
    const checksum = sha256(content);

    const prevChecksum = ledgerByFile.get(filename);
    if (prevChecksum !== undefined) {
      if (prevChecksum !== checksum) {
        throw new Error(
          `Migration ${filename} already applied with different checksum ` +
            `(was ${prevChecksum.slice(0, 12)}…, now ${checksum.slice(0, 12)}…). ` +
            "Migrations are immutable once applied — write a new migration instead.",
        );
      }
      continue;
    }

    jsonLog("info", "Applying migration", { filename, checksum });
    // Each migration wraps itself in BEGIN/COMMIT. `.unsafe()` is the
    // entry point for full-statement DDL; tagged-template would treat the
    // whole file as a single bound query which Postgres rejects.
    await sql.unsafe(content);

    // Record in the ledger. After 000_init.sql runs, _migrations exists and
    // is empty (the migration file itself does not insert its own row —
    // we do it here so the same code path handles all files uniformly).
    await sql`
      INSERT INTO _migrations (filename, checksum)
      VALUES (${filename}, ${checksum})
      ON CONFLICT (filename) DO NOTHING
    `;

    applied.push(filename);
  }

  jsonLog("info", "Migration run complete", {
    appliedCount: applied.length,
    totalFiles: files.length,
  });
  return applied;
}
