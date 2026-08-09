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
import {
  decideLegacyImport,
  parseLegacyDatetime,
} from "#src/db/legacy-rules.ts";

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

/** The subset of the client the import needs, so the same helpers work
 *  against either the client or an interactive transaction handle. */
type KarmaReader = Pick<typeof prisma, "karma" | "person">;

async function targetTotals(
  tx: KarmaReader,
  column: "giverId" | "receiverId",
): Promise<Totals> {
  const rows = await tx.karma.groupBy({
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

    // Validation runs INSIDE the transaction so a mismatch rolls the import
    // back. If it committed first, a failed check would leave the bad rows in
    // place — and because a non-empty target makes the startup import skip,
    // the next boot would silently serve data that failed verification.
    await prisma.$transaction(
      async (tx) => {
        await tx.person.createMany({ data: persons });
        await tx.karma.createMany({ data: karmaRows });

        compareTotals("Given", sourceGiven, await targetTotals(tx, "giverId"));
        compareTotals(
          "Received",
          sourceReceived,
          await targetTotals(tx, "receiverId"),
        );

        const importedPersons = await tx.person.count();
        const importedKarma = await tx.karma.count();
        if (
          importedPersons !== persons.length ||
          importedKarma !== karma.length
        ) {
          throw new Error(
            `Row counts do not match: person ${String(importedPersons)}/${String(persons.length)}, karma ${String(importedKarma)}/${String(karma.length)}`,
          );
        }
        console.warn(
          `[Import] ✓ Verified ${String(importedPersons)} person and ${String(importedKarma)} karma rows`,
        );
      },
      // The default interactive-transaction timeout is 5s; the import is small
      // but the verification adds several round trips, so allow headroom.
      { timeout: 60_000 },
    );
    console.warn("[Import] ✓ Committed");
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
    targetPersonRows: await prisma.person.count(),
  });

  if (decision.action === "skip") {
    console.warn(`[Import] Skipping legacy import: ${decision.reason}`);
    return;
  }

  await importLegacyDatabase(decision.sourcePath);
  console.warn("[Import] Legacy import complete");
}
