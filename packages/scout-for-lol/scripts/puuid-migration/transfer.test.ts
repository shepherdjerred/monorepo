import { afterAll, beforeEach, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

const dbPath = path.join(tmpdir(), "puuid-migration-transfer-test.sqlite");
process.env["DATABASE_URL"] = `file:${dbPath}`;

const OLD_A = `OLDA_${"a".repeat(70)}`;
const OLD_B = `OLDB_${"b".repeat(70)}`;
const NEW_A = `NEWA_${"y".repeat(70)}`;

async function remove(): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${dbPath}${suffix}`).delete();
    } catch {
      // Absent is the desired state.
    }
  }
}

async function open() {
  const { Database } = await import("bun:sqlite");
  new Database(dbPath, { create: true }).close();
  const { openDb } = await import("./db.ts");
  const { ensureMapTable } = await import("./map-table.ts");
  const db = await openDb();
  await ensureMapTable(db);
  return db;
}

beforeEach(remove);
afterAll(remove);

test("seed adds identities from an inventory and reports what it skipped", async () => {
  const db = await open();
  const { seedIdentities } = await import("./transfer.ts");
  const first = await seedIdentities(db, [OLD_A, OLD_B]);
  expect(first).toEqual({ added: 2, alreadyKnown: 0 });
  const again = await seedIdentities(db, [OLD_A, OLD_B]);
  expect(again).toEqual({ added: 0, alreadyKnown: 2 });
  await db.close();
});

test("seed refuses to record an identity that is already a migration RESULT", async () => {
  // The either-side skip. Recording a new-domain identifier as something to
  // migrate would send it to a key that can no longer decrypt anything.
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { seedIdentities } = await import("./transfer.ts");
  const result = await seedIdentities(db, [NEW_A]);
  expect(result).toEqual({ added: 0, alreadyKnown: 1 });
  await db.close();
});

test("a map survives export and import into another database", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "gameName", "tagLine", "newPuuid", "status")
     VALUES (${db.param(1)}, 'Zozio8z', 'EUW', ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'stranded')`,
    [OLD_B],
  );
  const { exportMap, serializeMap, parseMapRows } =
    await import("./transfer.ts");
  const rows = await exportMap(db);
  expect(parseMapRows(serializeMap(rows))).toEqual(rows);
  await db.close();
});

test("import does not carry appliedAt, which is a fact about the target", async () => {
  // Whether a mapping's rewrite has landed is true of one database at a time.
  // Importing it would tell the report lake to publish a translation the stored
  // columns do not hold yet.
  const db = await open();
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  expect(result).toEqual({ inserted: 1, updated: 0 });
  const rows = await db.query(
    `SELECT "appliedAt" AS v, "newPuuid" AS n FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["v"]).toBeNull();
  expect(rows[0]?.["n"]).toBe(NEW_A);
  await db.close();
});

test("import updates an existing row, because the imported map is the newer answer", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'pending')`,
    [OLD_A],
  );
  const { importMap } = await import("./transfer.ts");
  const result = await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  expect(result).toEqual({ inserted: 0, updated: 1 });
  const rows = await db.query(
    `SELECT "status" AS s, "newPuuid" AS n FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["s"]).toBe("resolved");
  expect(rows[0]?.["n"]).toBe(NEW_A);
  await db.close();
});

test("parseMapRows refuses a line with no identity rather than dropping it", async () => {
  const { parseMapRows } = await import("./transfer.ts");
  expect(() => parseMapRows(`{"status":"resolved"}`)).toThrow(/no oldPuuid/);
  expect(() => parseMapRows(`{"oldPuuid":"x"}`)).toThrow(/no status/);
});
