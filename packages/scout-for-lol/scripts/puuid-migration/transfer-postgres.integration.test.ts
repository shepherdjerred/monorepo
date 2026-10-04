import { afterAll, beforeEach, expect, test } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "@scout-for-lol/backend/testing/test-database.ts";
import { openDb } from "./db.ts";
import { ensureMapTable } from "./map-table.ts";
import { importMap } from "./transfer.ts";
import { ensureTestTemplate } from "@scout-for-lol/backend/testing/test-template.ts";

await ensureTestTemplate();
const { prisma, dbPath, dbUrl } = createTestDatabase("puuid-import-postgres");
process.env["DATABASE_URL"] = dbUrl;
const db = await openDb();
await ensureMapTable(db);

const OLD = `OLD_${"a".repeat(74)}`;
const NEW = `NEW_${"b".repeat(74)}`;

beforeEach(async () => {
  await db.exec('DELETE FROM "PuuidKeyMapHistory"');
  await db.exec('DELETE FROM "PuuidKeyMap"');
});

afterAll(async () => {
  await db.close();
  await dropTestDatabase(prisma, dbPath);
});

test("PostgreSQL imports replacements into existing pending rows", async () => {
  await db.exec(
    'INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES ($1, \'pending\')',
    [OLD],
  );
  await expect(
    importMap(db, [
      {
        oldPuuid: OLD,
        gameName: "N",
        tagLine: "T",
        newPuuid: NEW,
        status: "resolved",
      },
    ]),
  ).resolves.toEqual({ inserted: 0, updated: 1, downgraded: 0 });
  expect(
    await db.query(
      'SELECT "newPuuid", "status", "appliedAt" FROM "PuuidKeyMap"',
    ),
  ).toEqual([{ newPuuid: NEW, status: "resolved", appliedAt: null }]);
});

test("PostgreSQL imports null replacements without abandoning unapplied edges", async () => {
  await db.exec(
    'INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status") VALUES ($1, $2, \'resolved\')',
    [OLD, NEW],
  );
  await expect(
    importMap(db, [
      {
        oldPuuid: OLD,
        gameName: null,
        tagLine: null,
        newPuuid: null,
        status: "stranded",
      },
    ]),
  ).resolves.toEqual({ inserted: 0, updated: 1, downgraded: 1 });
  expect(
    await db.query(
      'SELECT "newPuuid", "status", "appliedAt" FROM "PuuidKeyMap"',
    ),
  ).toEqual([{ newPuuid: NEW, status: "resolved", appliedAt: null }]);
});

test("PostgreSQL preserves the applied marker when the imported edge is unchanged", async () => {
  const appliedAt = "2026-09-01T12:00:00.000Z";
  await db.exec(
    'INSERT INTO "PuuidKeyMap" ("oldPuuid", "newPuuid", "status", "appliedAt") VALUES ($1, $2, \'resolved\', $3)',
    [OLD, NEW, appliedAt],
  );
  const before = await db.query(
    'SELECT "newPuuid", "status", "appliedAt" FROM "PuuidKeyMap"',
  );
  expect(before[0]?.["appliedAt"]).toBeInstanceOf(Date);
  await importMap(db, [
    {
      oldPuuid: OLD,
      gameName: "N",
      tagLine: "T",
      newPuuid: NEW,
      status: "resolved",
    },
  ]);
  expect(
    await db.query(
      'SELECT "newPuuid", "status", "appliedAt" FROM "PuuidKeyMap"',
    ),
  ).toEqual(before);
});
