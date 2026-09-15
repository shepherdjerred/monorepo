/**
 * The verification gate, and the decision that lets it pass.
 *
 * Kept apart from the phases that change things: everything here reads, counts
 * and judges. `verify` is the only place that decides a cutover is complete,
 * and `strand` is the only place an identity is written off — both are about
 * what the migration is allowed to claim rather than what it does.
 */

import { cutoverApplied, strayIdentities } from "./cutover.ts";
import { composePuuidRemap } from "@scout-for-lol/backend/report-lake/puuid-remap.ts";
import type { Db } from "./db.ts";
import {
  discoverColumns,
  PUUID_TOKEN_PATTERN,
  type PuuidColumn,
} from "./discovery.ts";
import { asOptionalString, asString, countOf } from "./support.ts";

/** Rows in a scalar column still holding a translated old-domain PUUID. */
async function columnValues(db: Db, col: PuuidColumn): Promise<string[]> {
  const rows = await db.query(
    `SELECT "${col.column}" AS v FROM "${col.table}" WHERE "${col.column}" IS NOT NULL`,
  );
  return rows.flatMap((row) => {
    const value = asOptionalString(row["v"]);
    return value === null ? [] : [value];
  });
}

async function scalarSurvivors(
  db: Db,
  col: PuuidColumn,
  translated: ReadonlySet<string>,
): Promise<number> {
  const values = await columnValues(db, col);
  return values.filter((value) => translated.has(value)).length;
}

/**
 * JSON columns cannot be checked with a join, so scan their text for any
 * old-domain PUUID that has a replacement. Skipping them would have left 16 of
 * beta's 27 columns and 3 of prod's 6 unverified.
 */
async function jsonSurvivors(
  db: Db,
  col: PuuidColumn,
  translated: ReadonlySet<string>,
): Promise<number> {
  let survivors = 0;
  for (const value of await columnValues(db, col)) {
    for (const token of value.matchAll(PUUID_TOKEN_PATTERN)) {
      if (translated.has(token[0])) {
        survivors++;
        break;
      }
    }
  }
  return survivors;
}

/**
 * Accept every unresolved identity as permanently lost.
 *
 * Separate from `resolve` and gated behind its own flag because it is a
 * decision, not a step: these identities keep old-domain values forever, and
 * once the old key is retired nothing can revisit that. Printing the count and
 * requiring a deliberate act is the difference between an accepted loss and an
 * unnoticed one.
 */
export async function strand(db: Db, confirmed: boolean): Promise<void> {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "newPuuid" IS NULL AND "status" = 'unresolved'`,
  );
  const count = countOf(rows, "unresolved count");
  if (count === 0) {
    console.log("strand: nothing unresolved; no identity needs accepting");
    return;
  }
  if (!confirmed) {
    throw new Error(
      `${count.toString()} identities are unresolved. Accepting them is permanent — ` +
        `they keep old-domain PUUIDs and become unrecoverable once the old key is ` +
        `retired. Pass --accept-stranded to record that decision.`,
    );
  }
  await db.exec(
    `UPDATE "PuuidKeyMap" SET "status" = 'stranded' WHERE "newPuuid" IS NULL AND "status" = 'unresolved'`,
  );
  console.log(
    `strand: ${count.toString()} identities accepted as permanently old-domain`,
  );
}

export async function verify(db: Db): Promise<void> {
  const columns = await discoverColumns(db);
  const mapRows = await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMap"
      WHERE "newPuuid" IS NOT NULL
      ORDER BY "appliedAt", "oldPuuid"`,
  );
  const remap = new Map(
    mapRows.map((row) => [
      asString(row["oldPuuid"], "oldPuuid"),
      asString(row["newPuuid"], "newPuuid"),
    ]),
  );
  composePuuidRemap(remap);
  const translated = new Set(
    [...remap]
      .filter(([oldPuuid, newPuuid]) => oldPuuid !== newPuuid)
      .map(([oldPuuid]) => oldPuuid),
  );
  console.log(
    `  checking ${columns.length.toString()} columns against ${translated.size.toString()} translated identities`,
  );

  let survivors = 0;
  for (const col of columns) {
    const n =
      col.kind === "scalar"
        ? await scalarSurvivors(db, col, translated)
        : await jsonSurvivors(db, col, translated);
    if (n > 0) {
      console.error(
        `  ${col.table}.${col.column} (${col.kind}): ${n.toString()} old-domain rows`,
      );
      survivors += n;
    }
  }

  // The completeness check in `apply` runs before the rewrite, and the Postgres
  // path holds no lock across it, so an account registered during the cutover
  // could still slip in behind it. Re-checking here turns that race from
  // undetectable into a failed verification.
  const strays = await strayIdentities(db);
  if (strays.length > 0) {
    console.error(
      `  ${strays.length.toString()} tracked identities predate the cutover and have no map row; they were never migrated`,
    );
  }

  // Unresolved identities are invisible to the survivor scan above, which only
  // considers map entries that actually have a replacement. Counting them here
  // keeps `verify` honest about identities that were never migrated at all.
  //
  // `stranded` is excluded deliberately. Riot has no account for those either,
  // but an operator has looked at them and accepted the loss — whereas an
  // `unresolved` row is work not finished. A migration covering every
  // participant ever seen always turns up deleted accounts, so a gate that
  // cannot tell those apart could never pass; one that ignores the difference
  // would pass while real work was outstanding.
  const unresolvedRows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "newPuuid" IS NULL AND "status" <> 'stranded'`,
  );
  const unresolved = countOf(unresolvedRows, "unresolved count");
  if (unresolved > 0) {
    console.error(
      `  ${unresolved.toString()} identities are unresolved and keep old-domain PUUIDs`,
    );
  }

  const strandedRows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "status" = 'stranded'`,
  );
  const stranded = countOf(strandedRows, "stranded count");
  if (stranded > 0) {
    console.log(
      `  ${stranded.toString()} identities accepted as stranded; they keep old-domain PUUIDs permanently`,
    );
  }

  // A resolved mapping the lake will not publish. The rewrite can land and the
  // cutover be recorded while these go unstamped, and the survivor scan above
  // sees nothing wrong — no old value is left in the database. It is the lake
  // that would be wrong, months later, once the old key can no longer rebuild
  // the mapping.
  const unpublishedRows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "newPuuid" IS NOT NULL AND "appliedAt" IS NULL`,
  );
  const unpublished = countOf(unpublishedRows, "unpublished count");
  if (unpublished > 0) {
    console.error(
      `  ${unpublished.toString()} resolved mappings are not marked applied; the report lake will not use them`,
    );
  }

  // And the cutover itself has to be on record. `apply` stamps mappings before
  // writing this, so an interruption between the two leaves a database that is
  // fully rewritten and silent about it: nothing survives, nothing is
  // unpublished, and every check above passes. The report lake reads the absent
  // marker as "never migrated" and translates nothing, so the next rebuild
  // re-derives old-domain identifiers against accounts that have moved — and
  // the operator, having seen a green verify, has by then retired the only key
  // that could have rebuilt the mapping.
  //
  // A database that never migrated fails here too, which is correct: this is
  // the gate that proves a cutover completed, and it did not.
  const cutoverRecorded = await cutoverApplied(db);
  if (!cutoverRecorded) {
    console.error(
      `  the cutover is not recorded; the report lake would translate nothing`,
    );
  }

  // Every operand is an already-computed value, so the order is presentation
  // only; the counts are all gathered above regardless.
  if (
    !cutoverRecorded ||
    survivors > 0 ||
    unresolved > 0 ||
    strays.length > 0 ||
    unpublished > 0
  ) {
    // Throwing, not logging: this is the gate, and a gate that exits 0 on
    // failure is not a gate.
    throw new Error(
      `verify FAILED — ${survivors.toString()} rows hold translated old-domain PUUIDs, ` +
        `${unresolved.toString()} identities unresolved, ` +
        `${strays.length.toString()} tracked identities unmapped, ` +
        `${unpublished.toString()} mappings unpublished, ` +
        `cutover ${cutoverRecorded ? "recorded" : "NOT RECORDED"}`,
    );
  }
  console.log(
    `verify: clean — no translated PUUID survives in any of ${columns.length.toString()} columns`,
  );
}
