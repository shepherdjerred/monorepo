/**
 * Moving a map between the databases that need it.
 *
 * The hop that takes days needs only a Riot key and an internet connection, so
 * it runs against a local SQLite file rather than holding a tunnel to a cluster
 * database open for that long. This is how its result gets back: seed the
 * identities to work on, then carry the finished mappings into prod and beta.
 *
 * One map serves both. Prod and beta ran on the same old key, so an old PUUID
 * denotes the same player in either — harvesting once and importing twice
 * halves the Riot spend and guarantees the two environments agree.
 */

import { z } from "zod";
import { PuuidKeyMapStatusSchema } from "@scout-for-lol/data/model/riot/puuid-key-map.ts";
import type { Db } from "./db.ts";
import { asOptionalString, asString, countOf, toSqlParam } from "./support.ts";

export type MapRow = {
  oldPuuid: string;
  gameName: string | null;
  tagLine: string | null;
  newPuuid: string | null;
  status: string;
};

/** One JSON object per line, so a 240k-row map streams instead of loading. */
export function serializeMap(rows: readonly MapRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

/**
 * What a mapping must look like to be worth acting on.
 *
 * The file crosses machines, so nothing in it is trusted. An identifier that
 * merely parses as a string is not enough: `apply` rewrites every stored
 * reference to whatever it finds here, and `verify` would pass afterwards
 * because it only asks whether a replacement exists and the old value is gone.
 * One corrupted row therefore replaces real identities across two databases and
 * an archive, reports success, and cannot be undone once the old key is retired.
 */
const PuuidSchema = z
  .string()
  .regex(/^[\w-]{70,90}$/u, "not a PUUID: expected 70-90 base64url characters");

const MapRowSchema = z
  .object({
    oldPuuid: PuuidSchema,
    gameName: z.string().min(1).nullable().default(null),
    tagLine: z.string().min(1).nullable().default(null),
    newPuuid: PuuidSchema.nullable().default(null),
    status: PuuidKeyMapStatusSchema,
  })
  // A replacement and the status announcing it have to agree. Either half alone
  // is a row that behaves as neither: a `resolved` row with nothing to rewrite
  // to, or a replacement the gates read as unfinished work.
  .refine(
    (row) => (row.newPuuid === null) === (row.status !== "resolved"),
    "a mapping is resolved exactly when it has a replacement",
  )
  // An identifier mapping to itself is not a migration, and `resolve` already
  // treats one as proof that both credentials belong to the same key holder.
  // Accepting it here would be worse than there: for a participant who appears
  // only in the archive, `apply` and `verify` never see the row at all, so the
  // corpus rewrite replaces the token with itself, reports no failures, and
  // leaves that history old-domain permanently.
  .refine(
    (row) => row.newPuuid === null || row.newPuuid !== row.oldPuuid,
    "a replacement equal to the identifier it replaces is not a mapping",
  );

export function parseMapRows(text: string): MapRow[] {
  const rows: MapRow[] = [];
  // One identity, one answer. Two rows for the same identifier can slip in from
  // a hand edit or from concatenating two exports, and without this the last
  // one silently wins: the conflict check against the target compares each row
  // to what the DATABASE holds, so two rows that disagree with each other but
  // not with it both pass, and `apply` then rewrites to whichever landed last.
  const seen = new Map<string, string | null>();
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber++;
    if (line.trim() === "") {
      continue;
    }
    const parsed: unknown = JSON.parse(line);
    const result = MapRowSchema.safeParse(parsed);
    if (!result.success) {
      const why = result.error.issues
        .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `Map line ${lineNumber.toString()} is not a usable mapping (${why}): ${line.slice(0, 80)}`,
      );
    }
    const row = result.data;
    if (seen.has(row.oldPuuid)) {
      const first = seen.get(row.oldPuuid) ?? null;
      if (first !== row.newPuuid) {
        throw new Error(
          `Map line ${lineNumber.toString()} contradicts an earlier line: ` +
            `${row.oldPuuid.slice(0, 16)}… maps to both ${String(first).slice(0, 16)}… ` +
            `and ${String(row.newPuuid).slice(0, 16)}…`,
        );
      }
      continue;
    }
    seen.set(row.oldPuuid, row.newPuuid);
    rows.push(row);
  }
  return rows;
}

export async function exportMap(db: Db): Promise<MapRow[]> {
  const rows = await db.query(
    `SELECT "oldPuuid", "gameName", "tagLine", "newPuuid", "status"
       FROM "PuuidKeyMap" ORDER BY "oldPuuid"`,
  );
  return rows.map((row) => ({
    oldPuuid: asString(row["oldPuuid"], "oldPuuid"),
    gameName: asOptionalString(row["gameName"]),
    tagLine: asOptionalString(row["tagLine"]),
    newPuuid: asOptionalString(row["newPuuid"]),
    status: asString(row["status"], "status"),
  }));
}

/**
 * Add identities to work on, without disturbing anything already decided.
 *
 * A row whose PUUID the map already knows on EITHER side is left alone. On the
 * old side it is already being worked; on the new side it is the RESULT of an
 * earlier migration, and recording that as something to migrate would send a
 * new-domain identifier to a retired key.
 *
 * Deliberately not gated on the cutover marker, unlike `collect`. These
 * identities come from the archive, which is known to be old-domain, rather
 * than from database columns that may already have moved.
 */
export async function seedIdentities(
  db: Db,
  puuids: readonly string[],
): Promise<{ added: number; alreadyKnown: number }> {
  const known = new Set<string>();
  for (const row of await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMap"`,
  )) {
    known.add(asString(row["oldPuuid"], "oldPuuid"));
    const mapped = asOptionalString(row["newPuuid"]);
    if (mapped !== null) {
      known.add(mapped);
    }
  }

  let added = 0;
  for (const puuid of puuids) {
    if (known.has(puuid)) {
      continue;
    }
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'pending')`,
      [puuid],
    );
    known.add(puuid);
    added++;
  }
  return { added, alreadyKnown: puuids.length - added };
}

/**
 * Bring a finished map into a database that has to apply it.
 *
 * An existing row is updated rather than skipped: the local file is where the
 * work happened, so it is the newer answer. `appliedAt` is deliberately not
 * carried — whether a mapping's rewrite has landed is a fact about THIS
 * database, and importing someone else's would tell the report lake to publish
 * a translation the stored columns do not hold yet.
 *
 * With one exception, which is not symmetric: a replacement is never replaced by
 * its absence. An identity resolved by an earlier migration can fail to resolve
 * now — the account was deleted in between — and the scratch map would carry
 * `newPuuid: null` for it. Taking that as the newer answer would erase a durable
 * mapping that is still correct for every object already written, and nothing
 * could rebuild it once the old key is gone. Riot forgetting an account does not
 * unmake the identifier it used to have.
 */
export async function importMap(
  db: Db,
  rows: readonly MapRow[],
): Promise<{ inserted: number; updated: number }> {
  const existingRows = await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMap"`,
  );
  const existing = new Map(
    existingRows.map((row) => [
      asString(row["oldPuuid"], "oldPuuid"),
      asOptionalString(row["newPuuid"]),
    ]),
  );

  // Two different replacements for one identity are two irreconcilable claims,
  // and nothing here can tell which is right. Coalescing would silently pick
  // one, and the damage would be invisible: the database already holds a
  // replacement rather than the old value, so `apply` changes nothing and
  // `verify` passes, while the corpus rewrite translates the archive to the
  // wrong identity. Unlike a missing replacement, which is only older news,
  // this has to stop the import.
  for (const row of rows) {
    const held = existing.get(row.oldPuuid) ?? null;
    if (held !== null && row.newPuuid !== null && row.newPuuid !== held) {
      throw new Error(
        `Refusing to import: ${row.oldPuuid.slice(0, 16)}… already maps to ` +
          `${held.slice(0, 16)}… here, and the file says ${row.newPuuid.slice(0, 16)}…. ` +
          `Nothing can tell which is right, and overwriting would be invisible.`,
      );
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const params = [
      toSqlParam(row.oldPuuid, "oldPuuid"),
      toSqlParam(row.gameName, "gameName"),
      toSqlParam(row.tagLine, "tagLine"),
      toSqlParam(row.newPuuid, "newPuuid"),
      toSqlParam(row.status, "status"),
    ];
    if (existing.has(row.oldPuuid)) {
      // COALESCE, not assignment: an incoming null leaves a replacement this
      // database already holds standing. The status follows the same rule, so a
      // row that stays resolved is not relabelled as lost.
      await db.exec(
        `UPDATE "PuuidKeyMap"
            SET "gameName" = COALESCE(${db.param(2)}, "gameName"),
                "tagLine"  = COALESCE(${db.param(3)}, "tagLine"),
                "status"   = CASE WHEN ${db.param(4)} IS NULL AND "newPuuid" IS NOT NULL
                                  THEN "status" ELSE ${db.param(5)} END,
                "newPuuid" = COALESCE(${db.param(4)}, "newPuuid")
          WHERE "oldPuuid" = ${db.param(1)}`,
        params,
      );
      updated++;
      continue;
    }
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid", "gameName", "tagLine", "newPuuid", "status")
       VALUES (${db.param(1)}, ${db.param(2)}, ${db.param(3)}, ${db.param(4)}, ${db.param(5)})`,
      params,
    );
    inserted++;
  }
  return { inserted, updated };
}

/** How many rows the map holds, for reporting a transfer's effect. */
export async function mapSize(db: Db): Promise<number> {
  return countOf(
    await db.query(`SELECT COUNT(*) AS n FROM "PuuidKeyMap"`),
    "map size",
  );
}
