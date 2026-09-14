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

export function parseMapRows(text: string): MapRow[] {
  const rows: MapRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parsed: unknown = JSON.parse(line);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`Map line is not an object: ${line.slice(0, 80)}`);
    }
    const record: Record<string, unknown> = { ...parsed };
    const oldPuuid = record["oldPuuid"];
    const status = record["status"];
    if (typeof oldPuuid !== "string" || oldPuuid === "") {
      throw new Error(`Map line has no oldPuuid: ${line.slice(0, 80)}`);
    }
    if (typeof status !== "string" || status === "") {
      throw new Error(`Map line has no status: ${line.slice(0, 80)}`);
    }
    rows.push({
      oldPuuid,
      gameName: asOptionalString(record["gameName"]),
      tagLine: asOptionalString(record["tagLine"]),
      newPuuid: asOptionalString(record["newPuuid"]),
      status,
    });
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
  const existingRows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  const existing = new Set(
    existingRows.map((row) => asString(row["oldPuuid"], "oldPuuid")),
  );

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
