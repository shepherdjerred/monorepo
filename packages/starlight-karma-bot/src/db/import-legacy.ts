/**
 * Import of the legacy TypeORM/sql.js database into the Prisma-native database.
 *
 * Runs automatically at startup (see `scripts/start.ts`) and is also callable
 * as a one-shot CLI (`scripts/import-legacy.ts`). The legacy file is opened
 * read-only and never written, so it remains the rollback artifact.
 *
 * Every step fails loudly. There is no partial-import path: either the source
 * matches the expected legacy shape exactly and every row transfers with
 * matching per-user totals, or this throws and the write transaction rolls
 * back.
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import { prisma } from "#src/db/index.ts";

/**
 * Expected legacy column shape, verified against both the production and beta
 * databases:
 *
 *   CREATE TABLE "karma" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 *     "amount" integer NOT NULL, "datetime" datetime NOT NULL, "reason" text,
 *     "receiverId" varchar, "giverId" varchar, "guildId" text, ...)
 *   CREATE TABLE "person" ("id" varchar PRIMARY KEY NOT NULL)
 *
 * Compared field-by-field rather than as raw DDL text so that incidental
 * formatting differences do not fail the run, while a genuine shape change
 * (renamed or retyped column) still does.
 */
const EXPECTED_COLUMNS: Readonly<
  Record<
    string,
    readonly { name: string; type: string; notnull: 0 | 1; pk: number }[]
  >
> = {
  person: [{ name: "id", type: "varchar", notnull: 1, pk: 1 }],
  karma: [
    { name: "id", type: "integer", notnull: 1, pk: 1 },
    { name: "amount", type: "integer", notnull: 1, pk: 0 },
    { name: "datetime", type: "datetime", notnull: 1, pk: 0 },
    { name: "reason", type: "text", notnull: 0, pk: 0 },
    { name: "receiverId", type: "varchar", notnull: 0, pk: 0 },
    { name: "giverId", type: "varchar", notnull: 0, pk: 0 },
    { name: "guildId", type: "text", notnull: 0, pk: 0 },
  ],
};

const TableInfoRowsSchema = z.array(
  z.object({
    name: z.string(),
    type: z.string(),
    notnull: z.union([z.literal(0), z.literal(1)]),
    pk: z.number(),
  }),
);

const LegacyPersonRowsSchema = z.array(z.object({ id: z.string() }));

const LegacyKarmaRowsSchema = z.array(
  z.object({
    id: z.number(),
    amount: z.number(),
    datetime: z.string(),
    reason: z.string().nullable(),
    receiverId: z.string(),
    giverId: z.string(),
    guildId: z.string(),
  }),
);

const NullCountRowSchema = z.object({
  nullFk: z.number(),
  nullGuild: z.number(),
});

/**
 * TypeORM's sqlite driver wrote `datetime` as text with no timezone suffix.
 * Production carries two shapes:
 *
 *   - `2026-08-07 01:44:39.717` — 325 rows written by this bot
 *   - `2023-04-24 03:05:49`     — 37 rows, the `reason: "legacy karma"` import
 *                                 from the predecessor bot, written without
 *                                 milliseconds
 *
 * Both are UTC, confirmed against production rather than assumed: the database
 * file's mtime was `Aug 6 18:44` as rendered inside the container
 * (TZ=America/Los_Angeles, i.e. UTC-7 in August) while the newest row carries
 * `2026-08-07 01:44:39.717` — exactly seven hours ahead.
 */
const LEGACY_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/;

export function parseLegacyDatetime(value: string): Date {
  const match = LEGACY_DATETIME.exec(value);
  if (match === null) {
    throw new Error(
      `Legacy datetime ${JSON.stringify(value)} does not match the expected 'YYYY-MM-DD HH:MM:SS[.SSS]' format`,
    );
  }
  const [, year, month, day, hour, minute, second, millisecond] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      millisecond === undefined ? 0 : Number(millisecond),
    ),
  );
}

export type LegacyImportDecision =
  | { action: "skip"; reason: string }
  | { action: "import"; sourcePath: string };

/**
 * Decide whether startup should import the legacy database.
 *
 * Kept pure so the lifecycle is testable without a database or filesystem.
 *
 * The semantics are deliberately unambiguous:
 *   - `LEGACY_DATABASE_PATH` unset — nothing to migrate (fresh install, or the
 *     cutover already happened and the variable was removed). Skip.
 *   - Target already has karma — the import already ran. Skip. This is what
 *     makes an automatic import safe to leave wired up permanently.
 *   - Path set but the file is absent — a misconfiguration, not a state to
 *     tolerate: importing nothing here would silently start the bot with an
 *     empty leaderboard. Fail.
 */
export function decideLegacyImport(params: {
  legacyPath: string | undefined;
  legacyFileExists: boolean;
  targetKarmaRows: number;
}): LegacyImportDecision {
  const { legacyPath, legacyFileExists, targetKarmaRows } = params;

  if (legacyPath === undefined || legacyPath === "") {
    return { action: "skip", reason: "LEGACY_DATABASE_PATH is not set" };
  }
  if (targetKarmaRows > 0) {
    return {
      action: "skip",
      reason: `target already has ${String(targetKarmaRows)} karma row(s); the import already ran`,
    };
  }
  if (!legacyFileExists) {
    throw new Error(
      `LEGACY_DATABASE_PATH is set to ${legacyPath} but no file exists there. Unset it if there is nothing to migrate; otherwise fix the path — starting with an empty database would look like total karma loss.`,
    );
  }
  return { action: "import", sourcePath: legacyPath };
}

function verifySourceSchema(database: Database): void {
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = TableInfoRowsSchema.parse(
      database.query(`PRAGMA table_info("${table}")`).all(),
    ).map((row) => ({
      name: row.name,
      // SQLite type names are case-insensitive, and these databases report a
      // mix (`INTEGER`/`TEXT` but `datetime`/`varchar`). Normalize so casing
      // alone cannot fail the check.
      type: row.type.toLowerCase(),
      notnull: row.notnull,
      pk: row.pk,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Legacy table "${table}" does not match the expected schema.\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
      );
    }
  }
}

function verifyNoNulls(database: Database): void {
  const counts = NullCountRowSchema.parse(
    database
      .query(
        `SELECT
           (SELECT COUNT(*) FROM karma WHERE giverId IS NULL OR receiverId IS NULL) AS nullFk,
           (SELECT COUNT(*) FROM karma WHERE guildId IS NULL) AS nullGuild`,
      )
      .get(),
  );
  if (counts.nullFk !== 0 || counts.nullGuild !== 0) {
    throw new Error(
      `Legacy data has nulls the Prisma schema forbids: ${String(counts.nullFk)} null giver/receiver, ${String(counts.nullGuild)} null guildId. Backfill them before importing.`,
    );
  }
}

/** Per-person totals, keyed by person id. */
type Totals = Map<string, number>;

function sourceTotals(
  database: Database,
  column: "giverId" | "receiverId",
): Totals {
  const rows = z
    .array(z.object({ id: z.string(), total: z.number() }))
    .parse(
      database
        .query(
          `SELECT ${column} AS id, SUM(amount) AS total FROM karma GROUP BY ${column}`,
        )
        .all(),
    );
  return new Map(rows.map((row) => [row.id, row.total]));
}

async function targetTotals(column: "giverId" | "receiverId"): Promise<Totals> {
  const rows = await prisma.karma.groupBy({
    by: [column],
    _sum: { amount: true },
  });
  return new Map(
    rows.map((row) => [row[column], row._sum.amount ?? 0] as const),
  );
}

function compareTotals(label: string, source: Totals, target: Totals): void {
  const mismatches: string[] = [];
  const ids = new Set([...source.keys(), ...target.keys()]);
  for (const id of ids) {
    const from = source.get(id);
    const to = target.get(id);
    if (from !== to) {
      mismatches.push(`${id}: source=${String(from)} target=${String(to)}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `${label} totals do not match after import (${String(mismatches.length)} of ${String(ids.size)} people):\n  ${mismatches.join("\n  ")}`,
    );
  }
  console.warn(
    `[Import] ✓ ${label} totals match for all ${String(ids.size)} people`,
  );
}

/**
 * Import every row from `sourcePath`. Throws if the target is not empty — the
 * caller decides whether a populated target is an error (CLI) or a reason to
 * skip (startup).
 */
export async function importLegacyDatabase(sourcePath: string): Promise<void> {
  console.warn(`[Import] Reading legacy database: ${sourcePath}`);

  const existing = await prisma.karma.count();
  if (existing !== 0) {
    throw new Error(
      `Target database already has ${String(existing)} karma rows; refusing to import into a non-empty database.`,
    );
  }

  const source = new Database(sourcePath, { readonly: true, strict: true });
  try {
    verifySourceSchema(source);
    verifyNoNulls(source);
    console.warn("[Import] ✓ Source schema and null checks passed");

    const persons = LegacyPersonRowsSchema.parse(
      source.query("SELECT id FROM person ORDER BY id").all(),
    );
    const karma = LegacyKarmaRowsSchema.parse(
      source
        .query(
          "SELECT id, amount, datetime, reason, receiverId, giverId, guildId FROM karma ORDER BY id",
        )
        .all(),
    );

    const sourceGiven = sourceTotals(source, "giverId");
    const sourceReceived = sourceTotals(source, "receiverId");

    console.warn(
      `[Import] Read ${String(persons.length)} person and ${String(karma.length)} karma rows`,
    );

    // Parse every timestamp before opening the write transaction so a bad row
    // aborts without having written anything.
    const karmaRows = karma.map((row) => ({
      id: row.id,
      amount: row.amount,
      datetime: parseLegacyDatetime(row.datetime),
      reason: row.reason,
      receiverId: row.receiverId,
      giverId: row.giverId,
      guildId: row.guildId,
    }));

    await prisma.$transaction([
      prisma.person.createMany({ data: persons }),
      prisma.karma.createMany({ data: karmaRows }),
    ]);
    console.warn("[Import] ✓ Rows written");

    compareTotals("Given", sourceGiven, await targetTotals("giverId"));
    compareTotals("Received", sourceReceived, await targetTotals("receiverId"));

    const importedPersons = await prisma.person.count();
    const importedKarma = await prisma.karma.count();
    if (importedPersons !== persons.length || importedKarma !== karma.length) {
      throw new Error(
        `Row counts do not match: person ${String(importedPersons)}/${String(persons.length)}, karma ${String(importedKarma)}/${String(karma.length)}`,
      );
    }
    console.warn(
      `[Import] ✓ Imported ${String(importedPersons)} person and ${String(importedKarma)} karma rows`,
    );
  } finally {
    source.close();
  }
}

/**
 * Startup hook: import the legacy database if there is one and it has not been
 * imported yet. Safe to run on every boot.
 */
export async function runLegacyImportIfNeeded(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<void> {
  const legacyPath = environment["LEGACY_DATABASE_PATH"];
  const decision = decideLegacyImport({
    legacyPath,
    legacyFileExists:
      legacyPath === undefined || legacyPath === ""
        ? false
        : await Bun.file(legacyPath).exists(),
    targetKarmaRows: await prisma.karma.count(),
  });

  if (decision.action === "skip") {
    console.warn(`[Import] Skipping legacy import: ${decision.reason}`);
    return;
  }

  await importLegacyDatabase(decision.sourcePath);
  console.warn("[Import] Legacy import complete");
}
