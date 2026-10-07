import { afterAll, beforeEach, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

// support.ts reads the environment once at import, so every value has to be in
// place before the module graph loads.
const dbPath = path.join(tmpdir(), "puuid-migration-schema-test.sqlite");
process.env["OLD_RIOT_API_KEY"] = "test-old";
process.env["NEW_RIOT_API_KEY"] = "test-new";
process.env["DATABASE_URL"] = `file:${dbPath}`;

async function remove(): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${dbPath}${suffix}`).delete();
    } catch {
      // Absent is the desired state.
    }
  }
}

async function openWith(
  ddl: readonly string[],
): Promise<Awaited<ReturnType<typeof open>>> {
  const db = await open();
  for (const statement of ddl) {
    await db.exec(statement);
  }
  return db;
}

async function open() {
  const { Database } = await import("bun:sqlite");
  new Database(dbPath, { create: true }).close();
  const { openDb } = await import("./db.ts");
  return openDb();
}

beforeEach(remove);
afterAll(remove);

const ACCOUNT = `CREATE TABLE "Account" ("id" INTEGER PRIMARY KEY, "puuid" TEXT, "createdTime" INTEGER)`;

test("a declared source whose table is absent is not drift", async () => {
  // Prod and beta hold different subsets of these tables, and prod gains more
  // at promotion. Only Account exists here, and that has to be acceptable.
  const db = await openWith([ACCOUNT]);
  const { assertTrackedSourcesMatchSchema } = await import("./discovery.ts");
  await assertTrackedSourcesMatchSchema(db);
  await db.close();
});

test("a present source missing its timestamp column is named as drift", async () => {
  const db = await openWith([
    ACCOUNT,
    `CREATE TABLE "MatchRankHistory" ("id" INTEGER PRIMARY KEY, "puuid" TEXT)`,
  ]);
  const { assertTrackedSourcesMatchSchema } = await import("./discovery.ts");
  await expect(assertTrackedSourcesMatchSchema(db)).rejects.toThrow(
    /MatchRankHistory\.capturedAt/,
  );
  await db.close();
});

test("a present source missing its value column is named as drift", async () => {
  // Read alone, this one looks harmless — the source is simply skipped. That is
  // the hazard: every identity it was the only holder of silently stops being
  // tracked, and nothing downstream reports a loss.
  const db = await openWith([
    ACCOUNT,
    `CREATE TABLE "SummonerIndex" ("id" INTEGER PRIMARY KEY, "createdTime" INTEGER)`,
  ]);
  const { assertTrackedSourcesMatchSchema } = await import("./discovery.ts");
  await expect(assertTrackedSourcesMatchSchema(db)).rejects.toThrow(
    /SummonerIndex\.puuid/,
  );
  await db.close();
});

test("SQLite answers a query over the missing column instead of rejecting it", async () => {
  // Why the check above has to exist. A wrong column name in TRACKED_SOURCES is
  // not a SQL error here: SQLite accepts an unresolvable double-quoted name as a
  // string literal, so the row-selecting filter matches everything and the
  // literal comes back as the timestamp. Were this to start erroring, the guard
  // would be redundant — and this test would say so.
  const db = await openWith([
    `CREATE TABLE "MatchRankHistory" ("id" INTEGER PRIMARY KEY, "puuid" TEXT)`,
    `INSERT INTO "MatchRankHistory" VALUES (1, 'identity')`,
  ]);
  const rows = await db.query(
    `SELECT "puuid" AS v, "capturedAt" AS t FROM "MatchRankHistory" WHERE "capturedAt" IS NOT NULL`,
  );
  expect(rows).toEqual([{ v: "identity", t: "capturedAt" }]);
  await db.close();
});

test("discovery registers current mastery and durable payload columns", async () => {
  const db = await openWith([
    `CREATE TABLE "ChampionMasterySnapshot" ("puuid" TEXT PRIMARY KEY, "entriesJson" TEXT)`,
    `CREATE TABLE "ScoutWorkflowStart" ("requestId" TEXT PRIMARY KEY, "requestedWorkflowId" TEXT, "inputPayload" TEXT)`,
    `CREATE TABLE "MatchNotificationIntent" ("intentKey" TEXT PRIMARY KEY, "payload" TEXT)`,
    `CREATE TABLE "MatchSettlementAnnouncement" ("riotMatchId" TEXT, "family" TEXT, "itemKey" TEXT, "payload" TEXT, PRIMARY KEY ("riotMatchId", "family", "itemKey"))`,
  ]);
  const { discoverColumns } = await import("./discovery.ts");
  const columns = await discoverColumns(db);
  expect(columns.filter((column) => column.kind === "json")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table: "ChampionMasterySnapshot",
        column: "entriesJson",
      }),
      expect.objectContaining({
        table: "ScoutWorkflowStart",
        column: "inputPayload",
      }),
      expect.objectContaining({
        table: "MatchNotificationIntent",
        column: "payload",
      }),
      expect.objectContaining({
        table: "MatchSettlementAnnouncement",
        column: "payload",
      }),
    ]),
  );
  await db.close();
});

test("the audit preserves exact durable keys without exempting other work data", async () => {
  const identity = "p".repeat(78);
  const db = await openWith([
    `CREATE TABLE "ScoutTemporalWork" ("id" TEXT PRIMARY KEY, "payload" TEXT, "lastError" TEXT)`,
    `CREATE TABLE "ScoutWorkflowStart" ("requestId" TEXT PRIMARY KEY, "requestedWorkflowId" TEXT, "inputPayload" TEXT)`,
  ]);
  await db.exec(
    `INSERT INTO "ScoutTemporalWork" VALUES (${db.param(1)}, '{}', NULL)`,
    [`champion-mastery:${identity}:123`],
  );
  await db.exec(
    `INSERT INTO "ScoutWorkflowStart" VALUES ('request', ${db.param(1)}, '{}')`,
    [`scout-detached-work:champion-mastery:${identity}:123`],
  );
  const { auditForUnregistered, discoverColumns } =
    await import("./discovery.ts");
  const columns = await discoverColumns(db);
  await expect(auditForUnregistered(db, columns)).resolves.toBeUndefined();
  expect(
    columns.some(
      (column) =>
        column.column === "id" || column.column === "requestedWorkflowId",
    ),
  ).toBe(false);
  await db.exec(`UPDATE "ScoutTemporalWork" SET "lastError"=${db.param(1)}`, [
    identity,
  ]);
  await expect(auditForUnregistered(db, columns)).rejects.toThrow(
    /ScoutTemporalWork\.lastError/,
  );
  await db.close();
});
