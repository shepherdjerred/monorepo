import { afterAll, beforeEach, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

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
}): Promise<Awaited<ReturnType<typeof openDatabase>>> {
  const db = await openDatabase();
  await db.exec(
    `CREATE TABLE "Account" ("id" INTEGER PRIMARY KEY, "puuid" TEXT, "riotGameName" TEXT, "riotTagLine" TEXT)`,
  );
  await db.exec(
    `CREATE TABLE "MatchRankHistory" ("id" INTEGER PRIMARY KEY, "puuid" TEXT)`,
  );
  let id = 0;
  for (const puuid of options.accounts) {
    id++;
    await db.exec(
      `INSERT INTO "Account" VALUES (${db.param(1)}, ${db.param(2)}, 'Name', 'TAG')`,
      [id, puuid],
    );
  }
  const { ensureMapTable } = await import("./phases.ts");
  await ensureMapTable(db);
  for (const row of options.map ?? []) {
    await db.exec(
      `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "gameName", "tagLine") VALUES (${db.param(1)}, ${db.param(2)}, ${db.param(3)}, 'Name', 'TAG')`,
      [row.oldPuuid, row.newPuuid, row.status],
    );
  }
  if (options.applied === true) {
    await db.exec(
      `INSERT INTO "PuuidKeyMigration" ("id", "appliedAt") VALUES (1, ${db.now()})`,
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
  await db.exec(`INSERT INTO "MatchRankHistory" VALUES (1, ${db.param(1)})`, [
    OLD_A,
  ]);
  const { apply, verify } = await import("./phases.ts");
  await apply(db, false);
  const rows = await db.query(`SELECT "puuid" FROM "MatchRankHistory"`);
  expect(rows[0]?.["puuid"]).toBe(NEW_A);
  await verify(db);
  await db.close();
});

test("verify fails when a translated identity survives the rewrite", async () => {
  const db = await seed({
    accounts: [OLD_A],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { verify } = await import("./phases.ts");
  await expect(verify(db)).rejects.toThrow(/verify FAILED/);
  await db.close();
});

test("verify fails when a tracked identity was never mapped", async () => {
  const db = await seed({
    accounts: [NEW_A, POST_CUTOVER],
    map: [{ oldPuuid: OLD_A, newPuuid: NEW_A, status: "resolved" }],
  });
  const { verify } = await import("./phases.ts");
  await expect(verify(db)).rejects.toThrow(/unmapped/);
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
