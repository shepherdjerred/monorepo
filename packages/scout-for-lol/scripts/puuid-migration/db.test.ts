import { afterAll, beforeAll, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

// support.ts parses the environment once at import time, so every value must be
// in place before the module graph loads — including a single database path
// shared by the whole file.
const dbPath = path.join(tmpdir(), "puuid-migration-db-test.sqlite");
process.env["OLD_RIOT_API_KEY"] = "test-old";
process.env["NEW_RIOT_API_KEY"] = "test-new";
process.env["DATABASE_URL"] = `file:${dbPath}`;

async function removeDatabase(): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${dbPath}${suffix}`).delete();
    } catch {
      // Absent is the desired state; nothing to undo.
    }
  }
}

beforeAll(removeDatabase);
afterAll(removeDatabase);

/**
 * Regression: SQLite's bare `?` binds by order of APPEARANCE, not by number.
 * `harvest` and `resolve` both put param(2)/param(3) in SET and param(1) in
 * WHERE, so with bare placeholders the value and the key bound backwards, the
 * WHERE matched nothing, and the run reported success having written zero rows.
 * Postgres's `$1` is numbered, so beta never surfaced it.
 */
/** The migration refuses to create its target, so a fixture must exist first. */
async function openFixture() {
  const { Database } = await import("bun:sqlite");
  new Database(dbPath, { create: true }).close();
  const { openDb } = await import("./db.ts");
  return openDb();
}

test("bound parameters are positional by number, not by appearance", async () => {
  const db = await openFixture();

  await db.exec(`CREATE TABLE "T" ("key" TEXT PRIMARY KEY, "value" TEXT)`);
  await db.exec(
    `INSERT INTO "T" ("key", "value") VALUES (${db.param(1)}, ${db.param(2)})`,
    ["k1", "before"],
  );

  // Placeholders deliberately out of ascending order, mirroring resolve().
  await db.exec(
    `UPDATE "T" SET "value" = ${db.param(2)} WHERE "key" = ${db.param(1)}`,
    ["k1", "after"],
  );

  const rows = await db.query(`SELECT "key", "value" FROM "T"`);
  expect(rows).toEqual([{ key: "k1", value: "after" }]);

  await db.close();
});

test("discovery classifies scalar and JSON PUUID columns", async () => {
  const { discoverColumns } = await import("./discovery.ts");
  const db = await openFixture();

  await db.exec(
    `CREATE TABLE "Account" ("id" INTEGER PRIMARY KEY, "puuid" TEXT)`,
  );
  await db.exec(
    `CREATE TABLE "ActiveGame" ("id" INTEGER PRIMARY KEY, "trackedPuuids" TEXT)`,
  );
  await db.exec(`INSERT INTO "Account" VALUES (1, ${db.param(1)})`, ["p-1"]);
  await db.exec(`INSERT INTO "ActiveGame" VALUES (1, ${db.param(1)})`, [
    '["p-1","p-2"]',
  ]);

  const columns = await discoverColumns(db);
  expect(columns).toEqual([
    {
      table: "Account",
      column: "puuid",
      kind: "scalar",
      bareArrayIsPuuids: false,
    },
    {
      table: "ActiveGame",
      column: "trackedPuuids",
      kind: "json",
      bareArrayIsPuuids: true,
    },
  ]);

  await db.close();
});
