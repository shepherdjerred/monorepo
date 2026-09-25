/**
 * The phases that change things: discovery, the two Riot hops, and the rewrite.
 * Each is independent and safe to re-run. Verification lives in `verify.ts`.
 */

import type { Db } from "./db.ts";
import { composePuuidRemap } from "@scout-for-lol/backend/report-lake/puuid-remap.ts";
import {
  auditForUnregistered,
  discoverColumns,
  type PuuidColumn,
  readPuuids,
  readTrackedPuuids,
} from "./discovery.ts";
import { parseJson, translateJsonValue } from "./json-walk.ts";
import {
  collectKnownIdentities,
  cutoverApplied,
  strayIdentities,
} from "./cutover.ts";
import {
  byPuuid,
  byRiotId,
  estimateOldKeyMinutes,
  type RiotAccount,
} from "./riot.ts";
import {
  asOptionalString,
  asString,
  countOf,
  ARCHIVE_COLUMNS,
  toSqlParam,
  TRACKED_SOURCES,
} from "./support.ts";

/**
 * Fail on any PUUID column that is neither a tracked source nor a declared
 * archive. Omission is the dangerous direction — an unmigrated identity does
 * not raise an error, it just stops matching — so the classification has to be
 * explicit rather than assumed.
 */
function assertEveryColumnClassified(columns: readonly PuuidColumn[]): void {
  const classified = new Set([
    ...TRACKED_SOURCES.map((s) => `${s.table}.${s.column}`),
    ...ARCHIVE_COLUMNS.map((a) => `${a.table}.${a.column}`),
  ]);
  const unclassified = columns
    .map((c) => `${c.table}.${c.column}`)
    .filter((key) => !classified.has(key));
  if (unclassified.length > 0) {
    throw new Error(
      `These columns hold PUUIDs but are neither a tracked source nor a declared archive:\n` +
        unclassified.map((k) => `  ${k}`).join("\n") +
        `\nAdd each to TRACKED_SOURCES if anything compares its identities against live ` +
        `match data, or to ARCHIVE_COLUMNS if it is only ever read as history.`,
    );
  }
}

export async function collect(db: Db): Promise<void> {
  const columns = await discoverColumns(db);
  console.log(
    `  discovered ${columns.length.toString()} PUUID-bearing columns:`,
  );
  for (const c of columns) {
    console.log(`    ${c.table}.${c.column} (${c.kind})`);
  }

  // Every PUUID-bearing column must be deliberately classified: a source whose
  // identities get migrated, or an archive that is rewritten but never drives a
  // comparison. An unclassified column is the silent failure this migration has
  // hit twice — a Dare target and a duel member, both left in the old domain,
  // both failing by simply never matching again. So a new one stops the run
  // instead of being quietly skipped.
  assertEveryColumnClassified(columns);

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

  console.log(`\n  auditing every text column for unregistered PUUIDs...`);
  await auditForUnregistered(db, columns);
  console.log("  audit clean");

  // A replacement from a completed transition is the old-domain input for the
  // next one. Only a replacement whose current rewrite is still in flight is
  // suppressed, so a rerun after an interrupted apply stays resumable.
  const known = await collectKnownIdentities(db);

  const unknown = [...tracked].filter((puuid) => !known.has(puuid));

  // Whether the rewrite already ran against THIS database, read from the map
  // rather than inferred from the tracked rows. Inference was wrong: it asked
  // whether a tracked value matched a mapping, so a database whose migrated
  // accounts were all later untracked — or one migrated while tracking nobody —
  // read as unmigrated while being entirely new-domain. Recording an identity
  // then sends resolve to the retired key and blocks every later apply and
  // verify on a healthy account.
  const cutoverDone = await cutoverApplied(db);
  if (cutoverDone && unknown.length > 0) {
    throw new Error(
      `This database has already been rewritten to the new key domain, but ` +
        `${unknown.length.toString()} tracked identities are absent from the map.\n` +
        `They were registered after the cutover and are already new-domain, so ` +
        `collecting them would strand them against the retired key.\n` +
        `No action is needed for them; do not re-run the migration here.`,
    );
  }

  let recorded = 0;
  for (const puuid of unknown) {
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid") VALUES (${db.param(1)})
       ON CONFLICT ("oldPuuid") DO UPDATE SET
         "gameName" = NULL,
         "tagLine" = NULL,
         "newPuuid" = NULL,
         "status" = 'pending',
         "harvestedAt" = NULL,
         "resolvedAt" = NULL,
         "appliedAt" = NULL`,
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
 * Seeds Riot IDs already cached in the database, for operator visibility only.
 *
 * `resolve` does NOT trust these: it re-derives every Riot ID from the old key,
 * because a cached handle can have been reclaimed by someone else. Seeding just
 * gives the map readable names before the slow phase runs.
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
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "gameName" IS NULL`,
  );
  const unnamed = countOf(pending, "unnamed count");
  console.log(
    `  ${unnamed.toString()} identities have no cached Riot ID; resolve will derive them from the old key`,
  );
  console.log("harvest: complete");
}

/**
 * Resolve one identity, deriving its Riot ID from the old key every time.
 *
 * The cached Riot ID is never trusted for this hop, and a 404 is not the only
 * way it can be wrong. Riot IDs are reclaimable: if a tracked player renamed
 * away from `Name#TAG` and somebody else later claimed that handle, looking it
 * up under the new key returns 200 with a STRANGER's PUUID. Accepting that
 * would rewrite the tracked player onto another person's identity, irreversibly
 * and invisibly — collision detection only fires if that stranger happens to be
 * mapped too. Prod carried ten stale cached Riot IDs, so the precondition is
 * ordinary, not exotic.
 *
 * So the old key answers "who is this PUUID now?" immediately before the new key
 * answers "what is that person's PUUID under the new domain?". The two calls sit
 * back to back to keep the rename window as small as the network allows.
 */
async function resolveOne(
  db: Db,
  oldPuuid: string,
): Promise<RiotAccount | null> {
  const current = await byPuuid(oldPuuid);
  if (current === null) {
    return null;
  }
  await db.exec(
    `UPDATE "PuuidKeyMap" SET "gameName" = ${db.param(2)}, "tagLine" = ${db.param(3)} WHERE "oldPuuid" = ${db.param(1)}`,
    [oldPuuid, current.gameName, current.tagLine],
  );
  return byRiotId(current.gameName, current.tagLine);
}

export async function resolve(db: Db): Promise<void> {
  const rows = await db.query(
    `SELECT "oldPuuid" FROM "PuuidKeyMap" WHERE "newPuuid" IS NULL`,
  );
  // One old-key call per identity, so the personal-tier budget gates this
  // phase. The estimate comes from the limiter's own windows rather than a
  // second copy of the numbers, so it cannot drift from what is enforced.
  console.log(
    `  ${rows.length.toString()} to resolve, each re-derived from the old key first ` +
      `(~${estimateOldKeyMinutes(rows.length).toString()} min at the old key's budget)`,
  );

  for (const row of rows) {
    const oldPuuid = asString(row["oldPuuid"], "oldPuuid");
    const account = await resolveOne(db, oldPuuid);
    if (account === null) {
      await db.exec(
        `UPDATE "PuuidKeyMap" SET "status" = 'unresolved', "resolvedAt" = ${db.now()} WHERE "oldPuuid" = ${db.param(1)}`,
        [oldPuuid],
      );
      continue;
    }
    if (account.puuid === oldPuuid) {
      // Riot returned the same identifier, which means both keys belong to one
      // holder — almost certainly the same key passed twice. Accepting it would
      // mark the identity resolved, make `apply` a no-op, write the cutover
      // marker, and let `verify` report success; activating the real production
      // key afterwards would then leave every stored identity unusable, with the
      // marker now asserting the migration already happened. Across the real
      // prod and beta runs not one of 223 identities resolved unchanged, so this
      // is a configuration fault rather than a rare-but-valid answer.
      throw new Error(
        `Riot returned the same PUUID under both keys for ${oldPuuid.slice(0, 16)}….\n` +
          `OLD_RIOT_API_KEY and NEW_RIOT_API_KEY appear to belong to the same key holder, ` +
          `so this run would rewrite nothing while reporting success.`,
      );
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
      WHERE "newPuuid" IS NOT NULL AND "appliedAt" IS NULL
      GROUP BY "newPuuid" HAVING COUNT(*) > 1`,
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

async function rewriteScalarColumn(
  db: Db,
  col: PuuidColumn,
  map: ReadonlyMap<string, string>,
): Promise<void> {
  // Drive the rewrite from values the column actually stores, not every entry
  // in the corpus-wide map. The map is hundreds of thousands of rows while a
  // live scalar column usually contains tens or hundreds of relevant values;
  // issuing one UPDATE per map row would hold the online transaction open for
  // millions of statements. Looking up each distinct stored value in the
  // already-composed map preserves return-cycle semantics and stays portable
  // across SQLite and Postgres without a temporary table.
  const stored = await db.query(
    `SELECT DISTINCT "${col.column}" AS v FROM "${col.table}" WHERE "${col.column}" IS NOT NULL`,
  );
  let changed = 0;
  for (const row of stored) {
    const oldPuuid = asOptionalString(row["v"]);
    if (oldPuuid === null) {
      continue;
    }
    const newPuuid = map.get(oldPuuid);
    if (newPuuid === undefined) {
      continue;
    }
    await db.exec(
      `UPDATE "${col.table}" SET "${col.column}" = ${db.param(2)} WHERE "${col.column}" = ${db.param(1)}`,
      [oldPuuid, newPuuid],
    );
    changed++;
  }
  console.log(
    `  ${col.table}.${col.column}: ${changed.toString()} of ${stored.length.toString()} stored values rewritten`,
  );
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
    `SELECT "oldPuuid", "newPuuid", "appliedAt" FROM "PuuidKeyMap"
      WHERE "newPuuid" IS NOT NULL
      UNION ALL
      SELECT "oldPuuid", "newPuuid", "appliedAt" FROM "PuuidKeyMapHistory"
      ORDER BY "appliedAt" ASC NULLS LAST, "oldPuuid" ASC`,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const oldPuuid = asString(row["oldPuuid"], "oldPuuid");
    map.delete(oldPuuid);
    map.set(oldPuuid, asString(row["newPuuid"], "newPuuid"));
  }
  composePuuidRemap(map);
  for (const [oldPuuid, replacement] of map) {
    if (oldPuuid === replacement) {
      map.delete(oldPuuid);
    }
  }
  return map;
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
  //
  // Dated against the cutover marker, the same way verify judges them. Once the
  // rewrite has landed, an account registered since is already new-domain and is
  // correctly absent from the map — and `collect` refuses to record one, so
  // faulting it here would leave a re-run of `apply` with no way forward at all.
  // Only an identity that predates the marker was genuinely skipped.
  const strays = await strayIdentities(db);
  if (strays.length > 0) {
    throw new Error(
      `${strays.length.toString()} tracked identities appeared after collect and have no map row; ` +
        `re-run collect, harvest, and resolve before applying:\n` +
        strays
          .slice(0, 10)
          .map((p) => `  ${p.slice(0, 16)}…`)
          .join("\n"),
    );
  }

  // Stranded rows are a recorded decision, not an obstacle: an operator already
  // accepted that they keep old-domain values. Only rows still awaiting one
  // block the rewrite.
  const rows = await db.query(
    `SELECT "oldPuuid", "status", "gameName", "tagLine" FROM "PuuidKeyMap" WHERE "newPuuid" IS NULL AND "status" <> 'stranded'`,
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
        await rewriteScalarColumn(db, col, map);
      } else {
        await rewriteJsonColumn(db, col, map);
      }
    }
  });
  // Close the transition before stamping mapping rows. If the Postgres path
  // stops between these statements, collect still treats the already-written
  // replacements as current-domain values rather than reopening them under the
  // retired key. The applied marker remains unset until the rewrite is known to
  // have completed.
  await db.exec(
    `INSERT INTO "PuuidKeyMigration" ("id", "transitionOpen") VALUES (1, 0)
     ON CONFLICT ("id") DO UPDATE SET "transitionOpen" = 0`,
  );
  // Written after the rewrite, so an interrupted run leaves it unset and the
  // database still reads as mid-migration. Written unconditionally, so a cutover
  // performed while tracking no accounts is still recorded — updating mapping
  // rows would touch nothing there and lose exactly the case this marker exists
  // to cover.
  //
  // The first timestamp is the one that means something, so a re-run keeps it.
  // Advancing it would move the line every later judgement is made against:
  // every account registered since the real cutover would fall back on the
  // wrong side of it and be reported as work this migration skipped. COALESCE
  // rather than DO NOTHING, because the column is nullable and a row left there
  // by an interrupted run still needs filling in.
  // Per mapping first. The database-wide marker says a cutover happened; it
  // cannot say whether THIS mapping was part of it. An identity that a previous
  // run left unresolved and a later `resolve` recovered has a replacement the
  // stored columns do not hold yet, and publishing that to the report lake
  // would translate historical payloads to an identifier nothing joins against.
  //
  // Before the marker, not after, because the Postgres path holds no
  // transaction across these two statements. Stopping between them has to leave
  // the database reading as mid-migration — the marker absent — rather than
  // fully cut over with mappings the lake will not publish.
  await db.exec(
    `UPDATE "PuuidKeyMap" SET "appliedAt" = ${db.now()}
      WHERE "newPuuid" IS NOT NULL AND "appliedAt" IS NULL`,
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMigration" ("id", "appliedAt", "transitionOpen") VALUES (1, ${db.now()}, 0)
     ON CONFLICT ("id") DO UPDATE
        SET "appliedAt" = COALESCE("PuuidKeyMigration"."appliedAt", ${db.now()}),
            "transitionOpen" = 0`,
  );
  console.log("apply: complete");
}
