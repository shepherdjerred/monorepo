import { afterAll, beforeEach, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SqlParam } from "./support.ts";

// support.ts reads the environment once at import, so every value has to be in
// place before the module graph loads.
const dbPath = path.join(tmpdir(), "puuid-migration-phases-test.sqlite");
process.env["OLD_RIOT_API_KEY"] = "test-old";
process.env["NEW_RIOT_API_KEY"] = "test-new";
process.env["DATABASE_URL"] = `file:${dbPath}`;

const OLD_A = `OLDA_${"a".repeat(70)}`;
const OLD_B = `OLDB_${"b".repeat(70)}`;
const NEW_A = `NEWA_${"y".repeat(70)}`;
const NEW_B = `NEWB_${"z".repeat(70)}`;
const POST_CUTOVER = `POST_${"p".repeat(70)}`;

async function remove(): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${dbPath}${suffix}`).delete();
    } catch {
      // Absent is the desired state.
    }
  }
}

/**
 * A migration target in a chosen state. The phases behave differently across
 * three of them — nothing migrated, a rewrite interrupted partway, and a
 * completed cutover — and every regression this file guards came from one of
 * those branches being handled while another broke.
 */
async function seed(options: {
  accounts: string[];
  map?: {
    oldPuuid: string;
    newPuuid: string | null;
    status: string;
  }[];
  /** Marks the database as already rewritten to the new domain. */
  applied?: boolean;
  /** Epoch millis for the seeded accounts; defaults to now. */
  accountsCreatedAt?: number;
}): Promise<Awaited<ReturnType<typeof openDatabase>>> {
  const db = await openDatabase();
  await db.exec(
    `CREATE TABLE "Account" ("id" INTEGER PRIMARY KEY, "puuid" TEXT, "riotGameName" TEXT, "riotTagLine" TEXT, "createdTime" INTEGER)`,
  );
  await db.exec(
    // `capturedAt` is not decoration: MatchRankHistory is a tracked source, so
    // dating an unmapped identity reads this column. Omitting it did not fail —
    // SQLite reads an unknown quoted name as a string literal — it just made the
    // fixture a shape no real database has.
    `CREATE TABLE "MatchRankHistory" ("id" INTEGER PRIMARY KEY, "puuid" TEXT, "capturedAt" INTEGER)`,
  );
  await db.exec(
    `CREATE TABLE "MatchTrackedAccount" ("riotMatchId" TEXT, "puuid" TEXT, "createdAt" INTEGER, PRIMARY KEY ("riotMatchId", "puuid"))`,
  );
  await db.exec(
    `CREATE TABLE "BucksDareTarget" ("id" INTEGER PRIMARY KEY, "accounts" TEXT, "createdAt" INTEGER)`,
  );
  await db.exec(
    `CREATE TABLE "ScoutTemporalWork" ("id" TEXT PRIMARY KEY, "payload" TEXT, "state" TEXT, "createdAt" INTEGER)`,
  );
  // Defaults to well after the seeded cutover marker, so accounts read as
  // registered since it.
  const accountCreatedAt = options.accountsCreatedAt ?? Date.now();
  let id = 0;
  for (const puuid of options.accounts) {
    id++;
    await db.exec(
      // Epoch milliseconds, matching how the promoted SQLite image stores it.
      `INSERT INTO "Account" VALUES (${db.param(1)}, ${db.param(2)}, 'Name', 'TAG', ${db.param(3)})`,
      [id, puuid, accountCreatedAt],
    );
  }
  const { ensureMapTable } = await import("./map-table.ts");
  await ensureMapTable(db);
  for (const row of options.map ?? []) {
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "gameName", "tagLine") VALUES (${db.param(1)}, ${db.param(2)}, ${db.param(3)}, 'Name', 'TAG')`,
      [row.oldPuuid, row.newPuuid, row.status],
    );
  }
  if (options.applied === true) {
    // A completed cutover rewrote every mapping it had, so those rows carry a
    // per-mapping timestamp too.
    await db.exec(
      `UPDATE "PuuidKeyMap" SET "appliedAt" = datetime('now', '-1 day') WHERE "newPuuid" IS NOT NULL`,
    );
  }
  if (options.applied === true) {
    // Dated before the seeded accounts so they read as registered since the
    // cutover, which is the case the stray check must not fault.
    await db.exec(
      `INSERT INTO "PuuidKeyMigration" ("id", "appliedAt") VALUES (1, datetime('now', '-1 day'))`,
    );
  }
  return db;
}

async function openDatabase() {
  // The migration refuses to create its target, so the fixture has to exist
  // first — same as a real database would.
  const { Database } = await import("bun:sqlite");
  new Database(dbPath, { create: true }).close();
  const { openDb } = await import("./db.ts");
  return openDb();
}

beforeEach(remove);
afterAll(remove);

/**
 * Record a cutover the way a real one leaves the database: the database-wide
 * marker AND every mapping it rewrote. A fixture that sets only the marker
 * describes a state `apply` cannot produce.
 */
async function markCutover(
  db: Awaited<ReturnType<typeof openDatabase>>,
  at: string,
): Promise<void> {
  await db.exec(
    `INSERT INTO "PuuidKeyMigration" ("id", "appliedAt") VALUES (1, ${db.param(1)})`,
    [at],
  );
  await db.exec(
    `UPDATE "PuuidKeyMap" SET "appliedAt" = ${db.param(1)} WHERE "newPuuid" IS NOT NULL`,
    [at],
  );
}

/**
 * Both post-cutover cases assert the same contract: collect refuses and leaves
 * the map exactly as it found it, having recorded nothing.
 */
async function expectCollectRefusesAndRecordsNothing(
  db: Awaited<ReturnType<typeof openDatabase>>,
  mappedRows: number,
): Promise<void> {
  const { collect } = await import("./phases.ts");
  await expect(collect(db)).rejects.toThrow(/already been rewritten/);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.length).toBe(mappedRows);
  await db.close();
}

test("collect records every identity on an unmigrated database", async () => {
  const db = await seed({ accounts: [OLD_A, OLD_B] });
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.length).toBe(2);
  await db.close();
});

test("collect records nothing new when a rewrite was interrupted partway", async () => {
  // Account already rewritten, history not — the state a resumed apply sees.
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.length).toBe(1);
  await db.close();
});

test("collect refuses once the cutover is done and a new account has appeared", async () => {
  // POST_CUTOVER is already new-domain. Recording it would send resolve to the
  // retired key and block every later apply and verify on a healthy account.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await expectCollectRefusesAndRecordsNothing(db, 1);
});

test("apply refuses while any tracked identity is unresolved", async () => {
  const db = await seed({
    accounts: [OLD_A, OLD_B],
    map: [
      { oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" },
      { oldPuuid: OLD_B, newPuuid: null, status: "unresolved" },
    ],
  });
  const { apply } = await import("./phases.ts");
  await expect(apply(db, false)).rejects.toThrow(/unresolved/);
  await db.close();
});

test("apply resumes over a partially rewritten database", async () => {
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  await db.exec(
    `INSERT INTO "MatchRankHistory" VALUES (1, ${db.param(1)}, ${db.param(2)})`,
    [OLD_A, Date.now()],
  );
  const { apply } = await import("./phases.ts");
  const { verify } = await import("./verify.ts");
  await apply(db, false);
  const rows = await db.query(`SELECT "puuid" FROM "MatchRankHistory"`);
  expect(rows[0]?.["puuid"]).toBe(NEW_A);
  await verify(db);
  await db.close();
});

test("apply rewrites scalar columns to the newest return-cycle domain", async () => {
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  // A→B was applied by the prior cutover. The current transition returns to A,
  // so the retained map is a cycle whose newest edge must win for every column.
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [NEW_A, OLD_A],
  );
  await db.exec(
    `INSERT INTO "MatchRankHistory" VALUES (1, ${db.param(1)}, ${db.param(2)})`,
    [NEW_A, Date.now()],
  );

  const { apply } = await import("./phases.ts");
  await apply(db, false);

  const rows = await db.query(`SELECT "puuid" FROM "MatchRankHistory"`);
  expect(rows[0]?.["puuid"]).toBe(OLD_A);
  await db.close();
});

test("apply only updates scalar values present in the database", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  for (let index = 0; index < 100; index++) {
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
      [`unused-old-${index.toString()}`, `unused-new-${index.toString()}`],
    );
  }
  await db.exec(
    `INSERT INTO "MatchRankHistory" VALUES (1, ${db.param(1)}, ${db.param(2)})`,
    [OLD_A, Date.now()],
  );

  let scalarUpdates = 0;
  const measured = {
    ...db,
    exec: async (sql: string, params?: readonly SqlParam[]) => {
      if (
        /^UPDATE "(?:Account|MatchRankHistory|MatchTrackedAccount)" SET "puuid"/u.test(
          sql,
        )
      ) {
        scalarUpdates++;
      }
      await db.exec(sql, params);
    },
  };
  const { apply } = await import("./phases.ts");
  await apply(measured, false);

  expect(scalarUpdates).toBe(2);
  const rows = await db.query(`SELECT "puuid" FROM "MatchRankHistory"`);
  expect(rows[0]?.["puuid"]).toBe(NEW_A);
  await db.close();
});

test("verify fails when a translated identity survives the rewrite", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/verify FAILED/);
  await db.close();
});

test("verify fails when a tracked identity was never mapped", async () => {
  // No cutover marker: the migration is still in flight, so anything unmapped
  // is missed work.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unmapped/);
  await db.close();
});

test("verify accepts accounts registered after the cutover", async () => {
  // Both accounts postdate the marker written by seed(), so neither is a stray;
  // treating them as such would fail verify forever on healthy accounts.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  const { verify } = await import("./verify.ts");
  await verify(db);
  await db.close();
});

test("apply rejects a map that sends two identities to the same person", async () => {
  const db = await seed({
    accounts: [OLD_A, OLD_B],
    map: [
      { oldPuuid: OLD_A, newPuuid: NEW_B, status: "resolved" },
      { oldPuuid: OLD_B, newPuuid: NEW_B, status: "resolved" },
    ],
  });
  const { apply } = await import("./phases.ts");
  await expect(apply(db, false)).rejects.toThrow(/claimed by multiple/);
  await db.close();
});

test("collect still refuses after every migrated account was untracked", async () => {
  // The regression that killed inferring cutover state from tracked rows: no
  // tracked value matches a mapping any more, yet the database is new-domain.
  const db = await seed({
    accounts: [POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await expectCollectRefusesAndRecordsNothing(db, 1);
});

test("apply records the cutover marker once the rewrite lands", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMigration" WHERE "appliedAt" IS NOT NULL`,
  );
  expect(Number(rows[0]?.["n"])).toBe(1);
  await db.close();
});

test("apply records the cutover even when no identities were tracked", async () => {
  // The empty cutover: the database still moves domain, and a marker written by
  // updating mapping rows would have recorded nothing here.
  const db = await seed({ accounts: [] });
  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMigration" WHERE "appliedAt" IS NOT NULL`,
  );
  expect(Number(rows[0]?.["n"])).toBe(1);
  await db.close();
});

test("collect refuses after an empty cutover once a first account appears", async () => {
  const db = await seed({ accounts: [POST_CUTOVER], applied: true });
  await expectCollectRefusesAndRecordsNothing(db, 0);
});

test("verify still faults an account that predates the cutover", async () => {
  // The other direction of the same comparison: this account existed before the
  // rewrite and was never mapped, so it was genuinely skipped. A fix that simply
  // stopped flagging everything would let this through silently.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
    accountsCreatedAt: Date.parse("2020-01-01T00:00:00Z"),
  });
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unmapped/);
  await db.close();
});

test("verify faults an account created in the cutover's own second", async () => {
  // The marker used to truncate to whole seconds, so an account registered
  // later in that same second read as postdating a cutover it actually raced —
  // and was silently excused while holding an old-domain PUUID.
  const cutover = Date.parse("2026-09-13T11:34:41.000Z");
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    accountsCreatedAt: cutover + 400,
  });
  await markCutover(db, "2026-09-13T11:34:41.900Z");
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unmapped/);
  await db.close();
});

/**
 * A migrated database where one identity is known only to `MatchTrackedAccount`,
 * first seen at `seenAt`. That table records associations with no account row
 * and outlives account deletion, so it is the source that made dating from
 * `Account` alone wrong.
 */
const CUTOVER_AT = Date.parse("2026-09-13T11:34:41.000Z");

async function seedTrackedOnlySighting(
  seenAt: number,
): Promise<Awaited<ReturnType<typeof openDatabase>>> {
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    accountsCreatedAt: CUTOVER_AT - 60_000,
  });
  await markCutover(db, "2026-09-13T11:34:41.000Z");
  await db.exec(
    `INSERT INTO "MatchTrackedAccount" VALUES (${db.param(1)}, ${db.param(2)}, ${db.param(3)})`,
    ["NA1_1", POST_CUTOVER, seenAt],
  );
  return db;
}

test("verify accepts a post-cutover identity known only to MatchTrackedAccount", async () => {
  const db = await seedTrackedOnlySighting(CUTOVER_AT + 60_000);
  const { verify } = await import("./verify.ts");
  await verify(db);
  await db.close();
});

test("verify still faults an identity MatchTrackedAccount saw before the cutover", async () => {
  const db = await seedTrackedOnlySighting(CUTOVER_AT - 60_000);
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unmapped/);
  await db.close();
});

test("verify faults an identity only MatchRankHistory saw, before the cutover", async () => {
  // Rank history is a tracked source in its own right, so it can be the only
  // thing still naming an identity — and dating it means reading capturedAt.
  // A fixture without that column makes this case unreachable.
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    accountsCreatedAt: CUTOVER_AT - 60_000,
  });
  await markCutover(db, "2026-09-13T11:34:41.000Z");
  await db.exec(
    `INSERT INTO "MatchRankHistory" VALUES (1, ${db.param(1)}, ${db.param(2)})`,
    [POST_CUTOVER, CUTOVER_AT - 60_000],
  );
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unmapped/);
  await db.close();
});

test("apply re-runs after the cutover when a new account has registered", async () => {
  // The deadlock this replaced: the new account is already new-domain, so it is
  // correctly absent from the map — and collect refuses to record one once the
  // marker exists. Faulting it here left a re-run of apply with nowhere to go.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(`SELECT "puuid" FROM "Account" ORDER BY "id"`);
  expect(rows.map((r) => r["puuid"])).toEqual([NEW_A, POST_CUTOVER]);
  await db.close();
});

test("apply still refuses an identity that predates the cutover", async () => {
  // The other direction: this one existed before the rewrite and was never
  // mapped, so it was genuinely skipped rather than registered since.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
    accountsCreatedAt: Date.parse("2020-01-01T00:00:00Z"),
  });
  const { apply } = await import("./phases.ts");
  await expect(apply(db, false)).rejects.toThrow(/no map row/);
  await db.close();
});

test("a second apply keeps the timestamp the first one recorded", async () => {
  // Advancing the marker would move the line every later judgement is made
  // against: this account registered a minute after the real cutover, and a
  // re-run that restamped the marker would report it as work this migration
  // skipped.
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    accountsCreatedAt: CUTOVER_AT + 60_000,
  });
  await markCutover(db, "2026-09-13T11:34:41.000Z");
  const { apply } = await import("./phases.ts");
  const { verify } = await import("./verify.ts");
  await apply(db, false);
  const rows = await db.query(
    `SELECT "appliedAt" AS v FROM "PuuidKeyMigration"`,
  );
  expect(rows[0]?.["v"]).toBe("2026-09-13T11:34:41.000Z");
  await verify(db);
  await db.close();
});

test("apply fills a marker an interrupted run left empty", async () => {
  // The reason the conflict branch coalesces rather than doing nothing: the
  // column is nullable, and a row sitting there with no timestamp would
  // otherwise never get one.
  const db = await seed({ accounts: [] });
  await db.exec(
    `INSERT INTO "PuuidKeyMigration" ("id", "appliedAt") VALUES (1, NULL)`,
  );
  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(
    `SELECT "appliedAt" AS v FROM "PuuidKeyMigration"`,
  );
  expect(rows[0]?.["v"]).not.toBeNull();
  await db.close();
});

test("apply stamps the mappings it rewrote", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(
    `SELECT "appliedAt" AS v FROM "PuuidKeyMap" WHERE "oldPuuid" = ${db.param(1)}`,
    [OLD_A],
  );
  expect(rows[0]?.["v"]).not.toBeNull();
  await db.close();
});

test("an identity recovered after the cutover is not stamped until apply runs", async () => {
  // The `--allow-unresolved` recovery path. resolve fills in a replacement the
  // stored columns do not hold yet, and the database-wide marker is already set
  // — so only a per-mapping stamp can keep the report lake from translating
  // historical payloads to an identifier nothing joins against.
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_B, NEW_B],
  );
  const pending = await db.query(
    `SELECT "appliedAt" AS v FROM "PuuidKeyMap" WHERE "oldPuuid" = ${db.param(1)}`,
    [OLD_B],
  );
  expect(pending[0]?.["v"]).toBeNull();

  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const stamped = await db.query(
    `SELECT "appliedAt" AS v FROM "PuuidKeyMap" WHERE "oldPuuid" = ${db.param(1)}`,
    [OLD_B],
  );
  expect(stamped[0]?.["v"]).not.toBeNull();
  await db.close();
});

test("a map table predating appliedAt gains it and inherits the cutover time", async () => {
  // Prod's map was written before the column existed. Re-running any phase has
  // to add it without demoting mappings the completed cutover already applied.
  const db = await openDatabase();
  await db.exec(
    `CREATE TABLE "PuuidKeyMap" ("oldPuuid" TEXT PRIMARY KEY, "gameName" TEXT, "tagLine" TEXT, "newPuuid" TEXT, "status" TEXT, "harvestedAt" TEXT, "resolvedAt" TEXT)`,
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  await db.exec(
    `CREATE TABLE "PuuidKeyMigration" ("id" INTEGER PRIMARY KEY, "appliedAt" TEXT)`,
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMigration" VALUES (1, '2026-09-13T11:34:41.000Z')`,
  );
  const { ensureMapTable } = await import("./map-table.ts");
  await ensureMapTable(db);
  const rows = await db.query(`SELECT "appliedAt" AS v FROM "PuuidKeyMap"`);
  expect(rows[0]?.["v"]).toBe("2026-09-13T11:34:41.000Z");
  await db.close();
});

test("an unmigrated map predating appliedAt gains an empty column", async () => {
  // The same upgrade with no cutover recorded: nothing has been rewritten, so
  // nothing may claim it was.
  const db = await openDatabase();
  await db.exec(
    `CREATE TABLE "PuuidKeyMap" ("oldPuuid" TEXT PRIMARY KEY, "gameName" TEXT, "tagLine" TEXT, "newPuuid" TEXT, "status" TEXT, "harvestedAt" TEXT, "resolvedAt" TEXT)`,
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { ensureMapTable } = await import("./map-table.ts");
  await ensureMapTable(db);
  const rows = await db.query(`SELECT "appliedAt" AS v FROM "PuuidKeyMap"`);
  expect(rows[0]?.["v"]).toBeNull();
  await db.close();
});

test("verify fails when a rewritten mapping was never marked applied", async () => {
  // The interrupted-apply shape on Postgres, which holds no transaction across
  // the final statements. Nothing old survives in the database, so the survivor
  // scan is clean — but the report lake excludes the mapping, and that only
  // becomes visible once the old key can no longer rebuild it.
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await db.exec(`UPDATE "PuuidKeyMap" SET "appliedAt" = NULL`);
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unpublished/);
  await db.close();
});

test("verify fails when the rewrite landed but the cutover was never recorded", async () => {
  // The other side of apply's ordering. Stamping mappings before the marker
  // keeps the report lake from publishing early, but it leaves a database that
  // is fully rewritten and silent about it — every other check passes, and the
  // lake reads the absent marker as "never migrated".
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await db.exec(`DELETE FROM "PuuidKeyMigration"`);
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/NOT RECORDED/);
  await db.close();
});

test("verify fails while an identity is unresolved but undecided", async () => {
  const db = await seed({
    accounts: [NEW_A],
    map: [
      { oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" },
      { oldPuuid: OLD_B, newPuuid: null, status: "unresolved" },
    ],
    applied: true,
  });
  const { verify } = await import("./verify.ts");
  await expect(verify(db)).rejects.toThrow(/unresolved/);
  await db.close();
});

test("verify passes once an unresolvable identity is accepted as stranded", async () => {
  // Riot has no account either way. What changes is that someone looked at it
  // and accepted the loss — which is the only thing that can let a migration
  // covering every participant ever seen reach a green gate at all.
  const db = await seed({
    accounts: [NEW_A],
    map: [
      { oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" },
      { oldPuuid: OLD_B, newPuuid: null, status: "unresolved" },
    ],
    applied: true,
  });
  const { strand } = await import("./verify.ts");
  await strand(db, true);
  const { verify } = await import("./verify.ts");
  await verify(db);
  await db.close();
});

test("strand refuses to write off identities without an explicit decision", async () => {
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_B, newPuuid: null, status: "unresolved" }],
  });
  const { strand } = await import("./verify.ts");
  await expect(strand(db, false)).rejects.toThrow(/--accept-stranded/);
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "status" = 'stranded'`,
  );
  expect(Number(rows[0]?.["n"])).toBe(0);
  await db.close();
});

test("apply is not blocked by an identity already written off", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [
      { oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" },
      { oldPuuid: OLD_B, newPuuid: null, status: "stranded" },
    ],
  });
  const { apply } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(`SELECT "puuid" FROM "Account"`);
  expect(rows[0]?.["puuid"]).toBe(NEW_A);
  await db.close();
});

test("collect maps an identity frozen in a Dare after its account is removed", async () => {
  // A Dare pins its targets at creation and keeps matching them against live
  // games. Once the account row is gone the PUUID survives only here — and it
  // is still load-bearing, because evaluation compares it to match
  // participants. Leaving it un-migrated fails silently: the Dare simply never
  // resolves again.
  const db = await seed({ accounts: [] });
  await db.exec(
    `INSERT INTO "BucksDareTarget" VALUES (1, ${db.param(1)}, ${db.param(2)})`,
    [
      JSON.stringify([{ puuid: OLD_B, trackingStartedAt: "2026-01-01" }]),
      Date.now(),
    ],
  );
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(
    `SELECT "oldPuuid" FROM "PuuidKeyMap" WHERE "oldPuuid" = ${db.param(1)}`,
    [OLD_B],
  );
  expect(rows.length).toBe(1);
  await db.close();
});

test("collect maps the identity in an intent that has not been confirmed", async () => {
  // A subscription intent freezes its PUUID at prepare time and never
  // re-resolves it at confirm. Confirming one after the cutover would replay a
  // stale identifier into a new account the new key cannot use.
  const db = await seed({ accounts: [] });
  await db.exec(
    `CREATE TABLE "ConfirmationIntent" ("id" TEXT PRIMARY KEY, "payload" TEXT, "consumedAt" TEXT, "createdAt" INTEGER)`,
  );
  await db.exec(
    `INSERT INTO "ConfirmationIntent" VALUES ('pending', ${db.param(1)}, NULL, ${db.param(2)})`,
    [JSON.stringify({ kind: "subscription", puuid: OLD_A }), Date.now()],
  );
  await db.exec(
    `INSERT INTO "ConfirmationIntent" VALUES ('done', ${db.param(1)}, '2026-01-01', ${db.param(2)})`,
    [JSON.stringify({ kind: "subscription", puuid: OLD_B }), Date.now()],
  );
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(
    `SELECT "oldPuuid" FROM "PuuidKeyMap" ORDER BY "oldPuuid"`,
  );
  // Only the unconfirmed one is a reason to migrate an identity; the consumed
  // row is a record of work already done, and its account is tracked in its
  // own right.
  expect(rows.map((r) => r["oldPuuid"])).toEqual([OLD_A]);
  await db.close();
});

test("collect maps the account a rank Dare froze as its baseline", async () => {
  // The snapshot names its subject `sourcePuuid`, not `puuid`. Matching the
  // bare word walked straight past it, so the column would have been rewritten
  // while contributing no identity — and the audit would then abort on an
  // identifier nothing had collected.
  const db = await seed({ accounts: [] });
  await db.exec(
    `CREATE TABLE "BucksDareV2Activation" ("dareId" INTEGER PRIMARY KEY, "snapshotJson" TEXT, "createdAt" INTEGER)`,
  );
  await db.exec(
    `INSERT INTO "BucksDareV2Activation" VALUES (1, ${db.param(1)}, ${db.param(2)})`,
    [
      JSON.stringify({ kind: "rank", targetKey: "T1", sourcePuuid: OLD_A }),
      Date.now(),
    ],
  );
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.map((r) => r["oldPuuid"])).toEqual([OLD_A]);
  await db.close();
});

test("collect refuses an identifier no other column would recognise", async () => {
  // The hole the audit used to have. It matched against the identities already
  // collected, so a column whose only identity is tracked nowhere else had
  // nothing to be recognised by — the check meant to find the unknown could
  // only find the known. Nothing else here holds this value.
  const db = await seed({ accounts: [] });
  await db.exec(
    `CREATE TABLE "SomeOutbox" ("id" INTEGER PRIMARY KEY, "payloadJson" TEXT)`,
  );
  await db.exec(`INSERT INTO "SomeOutbox" VALUES (1, ${db.param(1)})`, [
    JSON.stringify({ holder: OLD_A }),
  ]);
  const { collect } = await import("./phases.ts");
  await expect(collect(db)).rejects.toThrow(/Unregistered PUUID-bearing/);
  await db.close();
});

test("collect refuses a PUUID column nobody classified", async () => {
  // The guard against the failure this migration hit twice: a column holding
  // identities that nothing migrates, failing silently later because an
  // unmigrated PUUID does not error, it just stops matching.
  const db = await seed({ accounts: [] });
  await db.exec(
    `CREATE TABLE "SomeNewFeature" ("id" INTEGER PRIMARY KEY, "puuid" TEXT)`,
  );
  await db.exec(`INSERT INTO "SomeNewFeature" VALUES (1, ${db.param(1)})`, [
    OLD_A,
  ]);
  const { collect } = await import("./phases.ts");
  await expect(collect(db)).rejects.toThrow(
    /neither a tracked source nor a declared archive/,
  );
  await db.close();
});

/** The payload shape Temporal work carries for a tracked player. */
const workPayload = (puuid: string, opponent?: string): string =>
  JSON.stringify({
    trackedPlayers: [{ league: { leagueAccount: { puuid } } }],
    ...(opponent === undefined
      ? {}
      : { gameInfo: { participants: [{ puuid: opponent }] } }),
  });

/** Queue one Temporal work row in a given state. */
async function queueWork(
  db: Awaited<ReturnType<typeof openDatabase>>,
  work: { id: string; state: string; puuid: string; opponent?: string },
): Promise<void> {
  await db.exec(
    `INSERT INTO "ScoutTemporalWork" VALUES (${db.param(1)}, ${db.param(2)}, ${db.param(3)}, ${db.param(4)})`,
    [work.id, workPayload(work.puuid, work.opponent), work.state, Date.now()],
  );
}

test("collect takes identities from requeueable work but not completed work", async () => {
  // A failed row is requeueable, so its payload is an instruction that will
  // still run and will write its identity into whatever that run produces. A
  // completed row is only a record — and those payloads are whole match
  // documents, so collecting them would drag the entire corpus back in.
  const db = await seed({ accounts: [] });
  await queueWork(db, { id: "w1", state: "failed", puuid: OLD_A });
  await queueWork(db, { id: "w2", state: "completed", puuid: OLD_B });
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.map((r) => r["oldPuuid"])).toEqual([OLD_A]);
  await db.close();
});

test("collect takes only the actionable identities from a work payload", async () => {
  // A queued job carries both the players it will act on and the full
  // participant list of the game it describes. Collecting the document whole
  // swept in every opponent — on beta, 245 identities instead of 16 — and any
  // stranger who no longer resolves would then block the rewrite.
  const db = await seed({ accounts: [] });
  await queueWork(db, {
    id: "w1",
    state: "failed",
    puuid: OLD_A,
    opponent: OLD_B,
  });
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.map((r) => r["oldPuuid"])).toEqual([OLD_A]);
  await db.close();
});

test("begin opens a new marker scope while retaining applied map rows", async () => {
  const db = await seed({
    accounts: [],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  const { beginTransition, cutoverApplied } = await import("./cutover.ts");
  await beginTransition(db, true);
  expect(await cutoverApplied(db)).toBe(false);
  const rows = await db.query(
    `SELECT "oldPuuid", "newPuuid", "appliedAt" FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["oldPuuid"]).toBe(OLD_A);
  expect(rows[0]?.["newPuuid"]).toBe(NEW_A);
  expect(rows[0]?.["appliedAt"]).not.toBeNull();
  await db.close();
});

test("collect treats a prior replacement as the next transition's old value", async () => {
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  const { beginTransition } = await import("./cutover.ts");
  await beginTransition(db, true);
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(
    `SELECT "oldPuuid", "status" FROM "PuuidKeyMap" ORDER BY "oldPuuid"`,
  );
  expect(rows).toEqual([
    { oldPuuid: NEW_A, status: "pending" },
    { oldPuuid: OLD_A, status: "resolved" },
  ]);
  await db.close();
});

test("collect does not reopen replacements after an interrupted marker write", async () => {
  const db = await seed({
    accounts: [NEW_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await db.exec(
    `UPDATE "PuuidKeyMigration" SET "appliedAt" = NULL, "transitionOpen" = 0`,
  );
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(`SELECT "oldPuuid" FROM "PuuidKeyMap"`);
  expect(rows.map((row) => row["oldPuuid"])).toEqual([OLD_A]);
  await db.close();
});

test("collect reopens the current domain after a return cycle", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [
      { oldPuuid: OLD_A, newPuuid: OLD_B, status: "resolved" },
      { oldPuuid: OLD_B, newPuuid: OLD_A, status: "resolved" },
    ],
    applied: true,
  });
  const { beginTransition } = await import("./cutover.ts");
  await beginTransition(db, true);
  const { collect } = await import("./phases.ts");
  await collect(db);
  const rows = await db.query(
    `SELECT "oldPuuid", "newPuuid", "status", "appliedAt"
       FROM "PuuidKeyMap" ORDER BY "oldPuuid"`,
  );
  expect(rows).toEqual([
    { oldPuuid: OLD_A, newPuuid: null, status: "pending", appliedAt: null },
    {
      oldPuuid: OLD_B,
      newPuuid: OLD_A,
      status: "resolved",
      appliedAt: expect.anything(),
    },
  ]);
  await db.close();
});

test("begin refuses to reset a marker with unresolved work", async () => {
  const db = await seed({
    accounts: [],
    map: [{ oldPuuid: OLD_A, newPuuid: null, status: "unresolved" }],
    applied: true,
  });
  const { beginTransition } = await import("./cutover.ts");
  await expect(beginTransition(db, true)).rejects.toThrow("unresolved work");
  await db.close();
});

test("begin refuses a resolved mapping whose rewrite was not applied", async () => {
  const db = await seed({
    accounts: [],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
    applied: true,
  });
  await db.exec(`UPDATE "PuuidKeyMap" SET "appliedAt" = NULL`);
  const { beginTransition } = await import("./cutover.ts");
  await expect(beginTransition(db, true)).rejects.toThrow("unresolved work");
  await db.close();
});
