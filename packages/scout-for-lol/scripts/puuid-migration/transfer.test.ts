import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { openFixtureDatabase, removeDatabase } from "./sqlite-fixture.ts";

const dbPath = path.join(tmpdir(), "puuid-migration-transfer-test.sqlite");
process.env["DATABASE_URL"] = `file:${dbPath}`;

const OLD_A = `OLDA_${"a".repeat(70)}`;
const OLD_B = `OLDB_${"b".repeat(70)}`;
const NEW_A = `NEWA_${"y".repeat(70)}`;

const remove = (): Promise<void> => removeDatabase(dbPath);

async function open() {
  const db = await openFixtureDatabase(dbPath);
  const { ensureMapTable } = await import("./map-table.ts");
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

describe("a map file is parsed, not trusted", () => {
  // It crosses machines. `apply` rewrites every stored reference to whatever is
  // in it, and `verify` would pass afterwards because it only asks whether a
  // replacement exists and the old value is gone — so a corrupted row replaces
  // real identities across two databases and an archive and reports success.
  const good = {
    oldPuuid: OLD_A,
    gameName: "Zozio8z",
    tagLine: "EUW",
    newPuuid: NEW_A,
    status: "resolved",
  };
  const line = (over: Record<string, unknown>) =>
    JSON.stringify({ ...good, ...over });

  test("accepts a well-formed mapping", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(parseMapRows(line({}))).toHaveLength(1);
  });

  test("refuses a replacement that is not a PUUID", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ newPuuid: "x" }))).toThrow(/not a PUUID/);
  });

  test("refuses an identity that is not a PUUID", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ oldPuuid: "x" }))).toThrow(/not a PUUID/);
  });

  test("refuses a status nothing understands", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ status: "probably-fine" }))).toThrow(
      /status/,
    );
  });

  test("refuses a resolved row with nothing to rewrite to", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() =>
      parseMapRows(line({ newPuuid: null, status: "resolved" })),
    ).toThrow(/resolved exactly when/);
  });

  test("refuses a replacement the gates would read as unfinished", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() => parseMapRows(line({ status: "pending" }))).toThrow(
      /resolved exactly when/,
    );
  });

  test("accepts a stranded row, which has no replacement by definition", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    const rows = parseMapRows(
      line({
        newPuuid: null,
        status: "stranded",
        gameName: null,
        tagLine: null,
      }),
    );
    expect(rows[0]?.status).toBe("stranded");
  });

  test("names the line it could not read", async () => {
    const { parseMapRows } = await import("./transfer.ts");
    expect(() =>
      parseMapRows(`${line({})}\n${line({ newPuuid: "x" })}`),
    ).toThrow(/line 2/);
  });
});

test("import never erases a replacement this database already holds", async () => {
  // An identity the earlier migration resolved can fail to resolve now, because
  // the account was deleted in between. The old mapping is still correct for
  // every object already written, and nothing can rebuild it once the old key
  // is gone — Riot forgetting an account does not unmake the identifier it used
  // to have.
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES (${db.param(1)}, ${db.param(2)}, 'resolved')`,
    [OLD_A, NEW_A],
  );
  const { importMap } = await import("./transfer.ts");
  await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: null,
      tagLine: null,
      newPuuid: null,
      status: "unresolved",
    },
  ]);
  const rows = await db.query(
    `SELECT "newPuuid" AS n, "status" AS s FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["n"]).toBe(NEW_A);
  expect(rows[0]?.["s"]).toBe("resolved");
  await db.close();
});

test("import still upgrades an unresolved row when a replacement arrives", async () => {
  const db = await open();
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'unresolved')`,
    [OLD_A],
  );
  const { importMap } = await import("./transfer.ts");
  await importMap(db, [
    {
      oldPuuid: OLD_A,
      gameName: "Zozio8z",
      tagLine: "EUW",
      newPuuid: NEW_A,
      status: "resolved",
    },
  ]);
  const rows = await db.query(
    `SELECT "newPuuid" AS n, "status" AS s FROM "PuuidKeyMap"`,
  );
  expect(rows[0]?.["n"]).toBe(NEW_A);
  expect(rows[0]?.["s"]).toBe("resolved");
  await db.close();
});
