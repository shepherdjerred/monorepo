/**
 * The five migration phases. Each is independent and safe to re-run.
 */

import type { Db } from "./db.ts";
import {
  auditForUnregistered,
  discoverColumns,
  PUUID_TOKEN_PATTERN,
  type PuuidColumn,
  readPuuids,
  readTrackedPuuids,
} from "./discovery.ts";
import { parseJson, translateJsonValue } from "./json-walk.ts";
import { byPuuid, byRiotId, type RiotAccount } from "./riot.ts";
import {
  asOptionalString,
  asString,
  countOf,
  OLD_KEY_LIMITS,
  toSqlParam,
} from "./support.ts";

export async function ensureMapTable(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "PuuidKeyMap" (
      "oldPuuid"    TEXT PRIMARY KEY,
      "gameName"    TEXT,
      "tagLine"     TEXT,
      "newPuuid"    TEXT,
      "status"      TEXT NOT NULL DEFAULT 'pending',
      "harvestedAt" ${db.timestampType()},
      "resolvedAt"  ${db.timestampType()}
    )
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS "PuuidKeyMap_status_idx" ON "PuuidKeyMap" ("status")`,
  );
}

export async function collect(db: Db): Promise<void> {
  const columns = await discoverColumns(db);
  console.log(
    `  discovered ${columns.length.toString()} PUUID-bearing columns:`,
  );
  for (const c of columns) {
    console.log(`    ${c.table}.${c.column} (${c.kind})`);
  }

  console.log("");
  const tracked = await readTrackedPuuids(db);
  console.log(`  ${tracked.size.toString()} distinct tracked identities`);

  // Everything else stays old-domain by design. Counting it makes the decision
  // visible instead of implicit: these are match participants we never resolve.
  let seenElsewhere = 0;
  const untracked = new Set<string>();
  for (const col of columns) {
    for (const value of await readPuuids(db, col)) {
      seenElsewhere++;
      if (!tracked.has(value)) {
        untracked.add(value);
      }
    }
  }
  console.log(
    `  ${untracked.size.toString()} distinct untracked PUUIDs will keep old-domain values ` +
      `(across ${seenElsewhere.toString()} stored references)`,
  );

  console.log(
    `\n  auditing every text column for unregistered TRACKED PUUIDs...`,
  );
  await auditForUnregistered(db, columns, tracked);
  console.log("  audit clean");

  for (const puuid of tracked) {
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid") VALUES (${db.param(1)}) ON CONFLICT DO NOTHING`,
      [puuid],
    );
  }
  console.log(
    `\ncollect: ${tracked.size.toString()} tracked PUUIDs recorded for migration`,
  );
}

/**
 * Seeds Riot IDs already cached in the database before spending any quota.
 * On prod that covers 199 of 256 identities, leaving 57 live lookups.
 */
async function seedFromCache(db: Db): Promise<void> {
  const sources = [
    { table: "Account", game: "riotGameName", tag: "riotTagLine" },
    { table: "SummonerIndex", game: "gameName", tag: "tagLine" },
  ];

  const tables = new Set(await db.listTables());
  for (const src of sources) {
    if (!tables.has(src.table)) {
      continue;
    }
    const columns = new Set(await db.listTextColumns(src.table));
    if (!columns.has(src.game) || !columns.has(src.tag)) {
      continue;
    }
    await db.exec(`
      UPDATE "PuuidKeyMap"
         SET "gameName" = (SELECT s."${src.game}" FROM "${src.table}" s WHERE s."puuid" = "PuuidKeyMap"."oldPuuid" LIMIT 1),
             "tagLine"  = (SELECT s."${src.tag}"  FROM "${src.table}" s WHERE s."puuid" = "PuuidKeyMap"."oldPuuid" LIMIT 1),
             "status"   = 'harvested',
             "harvestedAt" = ${db.now()}
       WHERE "status" = 'pending'
         AND EXISTS (
           SELECT 1 FROM "${src.table}" s
            WHERE s."puuid" = "PuuidKeyMap"."oldPuuid"
              AND s."${src.game}" IS NOT NULL
              AND s."${src.tag}" IS NOT NULL
         )
    `);
    console.log(`  seeded from ${src.table}`);
  }
}

export async function harvest(db: Db): Promise<void> {
  await seedFromCache(db);

  const pending = await db.query(
    `SELECT "oldPuuid" FROM "PuuidKeyMap" WHERE "status" = 'pending'`,
  );
  const minutes = Math.ceil(pending.length / OLD_KEY_LIMITS.perTwoMinutes) * 2;
  console.log(
    `  ${pending.length.toString()} need lookup (~${minutes.toString()} min at personal-key limits)`,
  );

  let done = 0;
  for (const row of pending) {
    const oldPuuid = asString(row["oldPuuid"], "oldPuuid");
    const account = await byPuuid(oldPuuid);
    if (account === null) {
      await db.exec(
        `UPDATE "PuuidKeyMap" SET "status" = 'unresolved', "harvestedAt" = ${db.now()} WHERE "oldPuuid" = ${db.param(1)}`,
        [oldPuuid],
      );
    } else {
      await db.exec(
        `UPDATE "PuuidKeyMap" SET "gameName" = ${db.param(2)}, "tagLine" = ${db.param(3)}, "status" = 'harvested', "harvestedAt" = ${db.now()} WHERE "oldPuuid" = ${db.param(1)}`,
        [oldPuuid, account.gameName, account.tagLine],
      );
    }
    done++;
    if (done % 25 === 0) {
      console.log(`  ${done.toString()}/${pending.length.toString()}`);
    }
  }
  console.log("harvest: complete");
}

/**
 * Resolve one identity, correcting a stale cached Riot ID if needed.
 *
 * `seedFromCache` trusts `Account.riotGameName` / `SummonerIndex.gameName`,
 * which go stale when a player renames. Observed in beta: a tracked account
 * cached as `CK ULTRA#333` had actually become `WICKINGTON#333`, so the
 * by-riot-id lookup 404'd and the identity would have orphaned permanently —
 * and unrecoverably, since the old key is the only thing that can map that
 * PUUID back to a human, and it is about to be retired.
 *
 * So a 404 here is not accepted until the Riot ID has been re-derived live
 * from the old key and retried.
 */
async function resolveOne(
  db: Db,
  oldPuuid: string,
  gameName: string,
  tagLine: string,
): Promise<RiotAccount | null> {
  const direct = await byRiotId(gameName, tagLine);
  if (direct !== null) {
    return direct;
  }

  const current = await byPuuid(oldPuuid);
  if (current === null) {
    return null;
  }
  if (current.gameName === gameName && current.tagLine === tagLine) {
    // The Riot ID was already current, so the account is genuinely gone.
    return null;
  }

  console.log(
    `  stale cache corrected: ${gameName}#${tagLine} -> ${current.gameName}#${current.tagLine}`,
  );
  await db.exec(
    `UPDATE "PuuidKeyMap" SET "gameName" = ${db.param(2)}, "tagLine" = ${db.param(3)} WHERE "oldPuuid" = ${db.param(1)}`,
    [oldPuuid, current.gameName, current.tagLine],
  );
  return byRiotId(current.gameName, current.tagLine);
}

export async function resolve(db: Db): Promise<void> {
  const rows = await db.query(
    `SELECT "oldPuuid", "gameName", "tagLine" FROM "PuuidKeyMap" WHERE "status" IN ('harvested', 'unresolved') AND "gameName" IS NOT NULL`,
  );
  console.log(`  ${rows.length.toString()} to resolve under the new key`);

  for (const row of rows) {
    const oldPuuid = asString(row["oldPuuid"], "oldPuuid");
    const gameName = asOptionalString(row["gameName"]);
    const tagLine = asOptionalString(row["tagLine"]);
    if (gameName === null || tagLine === null) {
      throw new Error(`${oldPuuid} is 'harvested' without a Riot ID`);
    }
    const account = await resolveOne(db, oldPuuid, gameName, tagLine);
    if (account === null) {
      await db.exec(
        `UPDATE "PuuidKeyMap" SET "status" = 'unresolved', "resolvedAt" = ${db.now()} WHERE "oldPuuid" = ${db.param(1)}`,
        [oldPuuid],
      );
      continue;
    }
    await db.exec(
      `UPDATE "PuuidKeyMap" SET "newPuuid" = ${db.param(2)}, "status" = 'resolved', "resolvedAt" = ${db.now()} WHERE "oldPuuid" = ${db.param(1)}`,
      [oldPuuid, account.puuid],
    );
  }
  console.log("resolve: complete");
}

/**
 * Two old PUUIDs mapping to one new PUUID means the same human was stored
 * twice under different identities. Rewriting would violate uniques on
 * Account, SummonerIndex, and the composite keys. That needs a human merge
 * decision, so it halts the run rather than guessing.
 */
async function assertNoCollisions(db: Db): Promise<void> {
  const collisions = await db.query(
    `SELECT "newPuuid", COUNT(*) AS n FROM "PuuidKeyMap"
      WHERE "newPuuid" IS NOT NULL GROUP BY "newPuuid" HAVING COUNT(*) > 1`,
  );
  if (collisions.length > 0) {
    const detail = collisions
      .map((c) => `  ${asOptionalString(c["newPuuid"]) ?? "?"}`)
      .join("\n");
    throw new Error(
      `${collisions.length.toString()} new PUUIDs are claimed by multiple old PUUIDs; merge these before applying:\n${detail}`,
    );
  }
}

async function rewriteScalarColumn(db: Db, col: PuuidColumn): Promise<void> {
  // The correlated-subquery form works identically on SQLite and Postgres,
  // unlike UPDATE ... FROM.
  await db.exec(`
    UPDATE "${col.table}"
       SET "${col.column}" = (
             SELECT m."newPuuid" FROM "PuuidKeyMap" m
              WHERE m."oldPuuid" = "${col.table}"."${col.column}"
           )
     WHERE "${col.column}" IN (
             SELECT "oldPuuid" FROM "PuuidKeyMap" WHERE "newPuuid" IS NOT NULL
           )
  `);
  console.log(`  ${col.table}.${col.column}: rewritten`);
}

async function rewriteJsonColumn(
  db: Db,
  col: PuuidColumn,
  map: ReadonlyMap<string, string>,
): Promise<void> {
  const pk = await db.primaryKey(col.table);
  if (pk.length === 0) {
    throw new Error(
      `${col.table} has no primary key; cannot rewrite its JSON column safely`,
    );
  }
  const pkList = pk.map((k) => `"${k}"`).join(", ");
  const rows = await db.query(
    `SELECT ${pkList}, "${col.column}" AS v FROM "${col.table}" WHERE "${col.column}" IS NOT NULL`,
  );
  const where = pk.map((k, i) => `"${k}" = ${db.param(i + 2)}`).join(" AND ");

  let changed = 0;
  for (const row of rows) {
    const value = asOptionalString(row["v"]);
    if (value === null) {
      continue;
    }
    const serialized = JSON.stringify(
      translateJsonValue(parseJson(value), map),
    );
    if (serialized === value) {
      continue;
    }
    await db.exec(
      `UPDATE "${col.table}" SET "${col.column}" = ${db.param(1)} WHERE ${where}`,
      [serialized, ...pk.map((k) => toSqlParam(row[k], `${col.table}.${k}`))],
    );
    changed++;
  }
  console.log(
    `  ${col.table}.${col.column}: ${changed.toString()}/${rows.length.toString()} rows rewritten`,
  );
}

async function loadMap(db: Db): Promise<Map<string, string>> {
  const rows = await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMap" WHERE "newPuuid" IS NOT NULL`,
  );
  return new Map(
    rows.map((r) => [
      asString(r["oldPuuid"], "oldPuuid"),
      asString(r["newPuuid"], "newPuuid"),
    ]),
  );
}

export async function apply(db: Db): Promise<void> {
  await assertNoCollisions(db);

  const stuckRows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "status" <> 'resolved'`,
  );
  const stuck = countOf(stuckRows, "unresolved count");
  if (stuck > 0) {
    console.warn(
      `  WARNING: ${stuck.toString()} PUUIDs are not resolved. Their rows keep old-domain values and will not join to anything.`,
    );
  }

  const columns = await discoverColumns(db);
  const map = await loadMap(db);

  await db.transaction(async () => {
    for (const col of columns) {
      if (col.kind === "scalar") {
        await rewriteScalarColumn(db, col);
      } else {
        await rewriteJsonColumn(db, col, map);
      }
    }
  });
  console.log("apply: complete");
}

/** Rows in a scalar column still holding a translated old-domain PUUID. */
async function scalarSurvivors(db: Db, col: PuuidColumn): Promise<number> {
  const rows = await db.query(`
    SELECT COUNT(*) AS n FROM "${col.table}" t
      JOIN "PuuidKeyMap" m ON t."${col.column}" = m."oldPuuid"
     WHERE m."newPuuid" IS NOT NULL
  `);
  return countOf(rows, "survivor count");
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
  const rows = await db.query(
    `SELECT "${col.column}" AS v FROM "${col.table}" WHERE "${col.column}" IS NOT NULL`,
  );
  let survivors = 0;
  for (const row of rows) {
    const value = asOptionalString(row["v"]);
    if (value === null) {
      continue;
    }
    for (const token of value.matchAll(PUUID_TOKEN_PATTERN)) {
      if (translated.has(token[0])) {
        survivors++;
        break;
      }
    }
  }
  return survivors;
}

export async function verify(db: Db): Promise<void> {
  const columns = await discoverColumns(db);
  const mapRows = await db.query(
    `SELECT "oldPuuid" FROM "PuuidKeyMap" WHERE "newPuuid" IS NOT NULL`,
  );
  const translated = new Set(
    mapRows.map((r) => asString(r["oldPuuid"], "oldPuuid")),
  );
  console.log(
    `  checking ${columns.length.toString()} columns against ${translated.size.toString()} translated identities`,
  );

  let survivors = 0;
  for (const col of columns) {
    const n =
      col.kind === "scalar"
        ? await scalarSurvivors(db, col)
        : await jsonSurvivors(db, col, translated);
    if (n > 0) {
      console.error(
        `  ${col.table}.${col.column} (${col.kind}): ${n.toString()} old-domain rows`,
      );
      survivors += n;
    }
  }

  if (survivors > 0) {
    // Throwing, not logging: this is the gate, and a gate that exits 0 on
    // failure is not a gate.
    throw new Error(
      `verify FAILED — ${survivors.toString()} rows still hold translated old-domain PUUIDs`,
    );
  }
  console.log(
    `verify: clean — no translated PUUID survives in any of ${columns.length.toString()} columns`,
  );
}
