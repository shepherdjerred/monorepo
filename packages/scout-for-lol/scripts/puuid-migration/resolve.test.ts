import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

const dbPath = path.join(tmpdir(), "puuid-migration-resolve-test.sqlite");
process.env["OLD_RIOT_API_KEY"] = "test-old";
process.env["NEW_RIOT_API_KEY"] = "test-new";
process.env["DATABASE_URL"] = `file:${dbPath}`;

const OLD_A = `OLDA_${"a".repeat(70)}`;
const NEW_A = `NEWA_${"y".repeat(70)}`;

// Resolution is the one phase that talks to Riot, and the behaviour under test
// is what it does with the answer — so the two hops are stubbed rather than the
// network.
const byPuuid = vi.fn();
const byRiotId = vi.fn();
vi.mock("./riot.ts", () => ({
  byPuuid: (...args: unknown[]) => byPuuid(...args),
  byRiotId: (...args: unknown[]) => byRiotId(...args),
}));

async function removeDatabase(): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${dbPath}${suffix}`).delete();
    } catch {
      // Absent is the desired state.
    }
  }
}

async function seedOneUnresolved() {
  await removeDatabase();
  const { Database } = await import("bun:sqlite");
  new Database(dbPath, { create: true }).close();
  const { openDb } = await import("./db.ts");
  const { ensureMapTable } = await import("./phases.ts");
  const db = await openDb();
  await ensureMapTable(db);
  await db.exec(
    `INSERT INTO "PuuidKeyMap" ("oldPuuid", "status") VALUES (${db.param(1)}, 'pending')`,
    [OLD_A],
  );
  return db;
}

beforeAll(removeDatabase);
afterAll(removeDatabase);

test("resolve records a genuine cross-domain mapping", async () => {
  byPuuid.mockResolvedValue({
    puuid: OLD_A,
    gameName: "Alpha",
    tagLine: "NA1",
  });
  byRiotId.mockResolvedValue({
    puuid: NEW_A,
    gameName: "Alpha",
    tagLine: "NA1",
  });
  const db = await seedOneUnresolved();
  const { resolve } = await import("./phases.ts");
  await resolve(db);
  const rows = await db.query(`SELECT "newPuuid" FROM "PuuidKeyMap"`);
  expect(rows[0]?.["newPuuid"]).toBe(NEW_A);
  await db.close();
});

test("resolve refuses when both keys belong to the same holder", async () => {
  // Riot answering with the same identifier means the two keys share a holder —
  // in practice, one key passed twice. Accepting it would mark the identity
  // resolved, make apply a no-op, write the cutover marker, and let verify
  // report success on a migration that moved nothing.
  byPuuid.mockResolvedValue({
    puuid: OLD_A,
    gameName: "Alpha",
    tagLine: "NA1",
  });
  byRiotId.mockResolvedValue({
    puuid: OLD_A,
    gameName: "Alpha",
    tagLine: "NA1",
  });
  const db = await seedOneUnresolved();
  const { resolve } = await import("./phases.ts");
  await expect(resolve(db)).rejects.toThrow(/same key holder/);
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap" WHERE "newPuuid" IS NOT NULL`,
  );
  expect(Number(rows[0]?.["n"])).toBe(0);
  await db.close();
});
