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

  // Skip identities the map already knows on EITHER side. After a completed
  // apply the tracked columns hold new-domain values, so inserting them blindly
  // would create a second, bogus `pending` row per migrated player — which
  // harvest would then 404 against the old key and apply would refuse. Re-running
  // collect is advertised as safe, so it has to be.
  const known = await knownIdentities(db);
  let recorded = 0;
  for (const puuid of tracked) {
    if (known.has(puuid)) {
      continue;
    }
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid") VALUES (${db.param(1)}) ON CONFLICT DO NOTHING`,
      [puuid],
    );
    recorded++;
  }
  console.log(
    `\ncollect: ${recorded.toString()} new tracked PUUIDs recorded ` +
      `(${(tracked.size - recorded).toString()} already mapped)`,
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

/**
 * Tracked identities the map has never seen, in either domain.
 *
 * Both sides count as known. A rerun after an interrupted apply finds rows that
 * earlier statements already rewrote — the Postgres path has no enclosing
 * transaction, by design, so a partial apply is expected and resumable. Judging
 * only by `oldPuuid` would classify those already-migrated rows as strangers and
 * abort exactly where resumability is supposed to work.
 *
 * What this still catches is the real hazard: an account registered after
 * `collect`, which has no map row at all and would otherwise be rewritten to
 * nothing and stranded.
 */
async function knownIdentities(db: Db): Promise<Set<string>> {
  const rows = await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMap"`,
  );
  const known = new Set<string>();
  for (const row of rows) {
    known.add(asString(row["oldPuuid"], "oldPuuid"));
    const mapped = asOptionalString(row["newPuuid"]);
    if (mapped !== null) {
      known.add(mapped);
    }
  }
  return known;
}

async function unmappedTrackedIdentities(db: Db): Promise<string[]> {
  const tracked = await readTrackedPuuids(db);
  const known = await knownIdentities(db);
  return [...tracked].filter((puuid) => !known.has(puuid));
}

/**
 * Refuse to rewrite while any tracked identity is still unresolved.
 *
 * An unresolved identity keeps its old-domain PUUID, which Riot cannot decrypt
 * once the new key is live — and `verify` cannot see the problem, because it
 * only inspects rows whose map entry has a `newPuuid`. Warning and proceeding
 * would let a partial migration finish looking green while quietly stranding
 * real players. Leaving one behind has to be a deliberate, recorded choice, so
 * it requires an explicit flag rather than a log line nobody reads.
 */
async function assertEveryIdentityResolved(
  db: Db,
  allowUnresolved: boolean,
): Promise<void> {
  // Checking only the map would miss an account registered AFTER collect ran —
  // the old key keeps serving traffic through harvest and resolve, so new
  // tracked accounts can appear mid-cutover with no map row at all. Comparing
  // against the live tracked set catches those; they are unmigrated, not merely
  // unresolved.
  const unmapped = await unmappedTrackedIdentities(db);
  if (unmapped.length > 0) {
    throw new Error(
      `${unmapped.length.toString()} tracked identities appeared after collect and have no map row; ` +
        `re-run collect, harvest, and resolve before applying:\n` +
        unmapped
          .slice(0, 10)
          .map((p) => `  ${p.slice(0, 16)}…`)
          .join("\n"),
    );
  }

  const rows = await db.query(
    `SELECT "oldPuuid", "status", "gameName", "tagLine" FROM "PuuidKeyMap" WHERE "newPuuid" IS NULL`,
  );
  if (rows.length === 0) {
    return;
  }
  const detail = rows
    .slice(0, 20)
    .map((r) => {
      const puuid = asString(r["oldPuuid"], "oldPuuid");
      const status = asOptionalString(r["status"]) ?? "?";
      const name = asOptionalString(r["gameName"]);
      const tag = asOptionalString(r["tagLine"]);
      const who =
        name === null || tag === null ? "(no Riot ID)" : `${name}#${tag}`;
      return `  ${puuid.slice(0, 16)}… ${status} ${who}`;
    })
    .join("\n");
  const more =
    rows.length > 20 ? `\n  …and ${(rows.length - 20).toString()} more` : "";

  if (!allowUnresolved) {
    throw new Error(
      `${rows.length.toString()} tracked identities are unresolved; refusing to rewrite.\n` +
        `Re-run harvest/resolve, or pass --allow-unresolved to accept stranding them:\n${detail}${more}`,
    );
  }
  console.warn(
    `  PROCEEDING with ${rows.length.toString()} unresolved identities (--allow-unresolved).\n` +
      `  These keep old-domain PUUIDs and will not resolve against the new key:\n${detail}${more}`,
  );
}

export async function apply(db: Db, allowUnresolved: boolean): Promise<void> {
  await assertNoCollisions(db);
  await assertEveryIdentityResolved(db, allowUnresolved);

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

  // The completeness check in `apply` runs before the rewrite, and the Postgres
  // path holds no lock across it, so an account registered during the cutover
  // could still slip in behind it. Re-checking here turns that race from
  // undetectable into a failed verification.
  const strays = await unmappedTrackedIdentities(db);
  if (strays.length > 0) {
    console.error(
      `  ${strays.length.toString()} tracked identities have no map row; they were registered after collect and are unmigrated`,
    );
  }

  // Unresolved identities are invisible to the survivor scan above, which only
  // considers map entries that actually have a replacement. Counting them here
  // keeps `verify` honest about identities that were never migrated at all.
  const unresolvedRows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "newPuuid" IS NULL`,
  );
  const unresolved = countOf(unresolvedRows, "unresolved count");
  if (unresolved > 0) {
    console.error(
      `  ${unresolved.toString()} tracked identities were never resolved and keep old-domain PUUIDs`,
    );
  }

  if (survivors > 0 || unresolved > 0 || strays.length > 0) {
    // Throwing, not logging: this is the gate, and a gate that exits 0 on
    // failure is not a gate.
    throw new Error(
      `verify FAILED — ${survivors.toString()} rows hold translated old-domain PUUIDs, ` +
        `${unresolved.toString()} identities unresolved, ` +
        `${strays.length.toString()} tracked identities unmapped`,
    );
  }
  console.log(
    `verify: clean — no translated PUUID survives in any of ${columns.length.toString()} columns`,
  );
}
