#!/usr/bin/env bun
/**
 * One-shot import of the legacy TypeORM/sql.js database into the Prisma-native
 * database.
 *
 * The legacy file is opened read-only and never written. Run against a target
 * that has had `prisma migrate deploy` applied and is otherwise empty:
 *
 *   DATABASE_PATH=./data/karma.db bun scripts/import-legacy.ts ./data/glitter.sqlite
 *
 * Every step fails loudly. There is no partial-import path: either the source
 * matches the expected legacy shape exactly and every row transfers with
 * matching per-user totals, or the script throws and the target is left
 * untouched by the surrounding transaction.
 */
import { Database } from "bun:sqlite";
import { z } from "zod";
import { prisma, disconnectPrisma } from "#src/db/index.ts";

const DEFAULT_SOURCE = "./data/glitter.sqlite";

/**
 * Expected legacy column shape, taken from the live production database:
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

function verifySourceSchema(database: Database): void {
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = TableInfoRowsSchema.parse(
      database.query(`PRAGMA table_info("${table}")`).all(),
    ).map((row) => ({
      name: row.name,
      // SQLite type names are case-insensitive, and this database reports a
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

/** Per-person totals, keyed `${personId}` → summed amount. */
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

async function main(): Promise<void> {
  const sourcePath = Bun.argv[2] ?? DEFAULT_SOURCE;
  console.warn(`[Import] Reading legacy database: ${sourcePath}`);

  const existing = await prisma.karma.count();
  if (existing !== 0) {
    throw new Error(
      `Target database already has ${String(existing)} karma rows; refusing to import into a non-empty database.`,
    );
  }

  const source = new Database(sourcePath, { readonly: true, strict: true });
  let persons: { id: string }[];
  let karma: z.infer<typeof LegacyKarmaRowsSchema>;
  try {
    verifySourceSchema(source);
    verifyNoNulls(source);
    console.warn("[Import] ✓ Source schema and null checks passed");

    persons = LegacyPersonRowsSchema.parse(
      source.query("SELECT id FROM person ORDER BY id").all(),
    );
    karma = LegacyKarmaRowsSchema.parse(
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

// Guarded so `parseLegacyDatetime` can be imported by tests without running an
// import against whatever database the environment happens to point at.
if (import.meta.main) {
  try {
    await main();
    console.warn("[Import] Complete");
  } finally {
    await disconnectPrisma();
  }
}
