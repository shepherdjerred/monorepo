import { afterAll, beforeEach, expect, test } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  openFixtureDatabase,
  removeDatabase,
} from "#scripts/puuid-migration/sqlite-fixture.ts";

const dbPath = path.join(tmpdir(), "puuid-corpus-observations-test.sqlite");
process.env["DATABASE_URL"] = `file:${dbPath}`;

const remove = (): Promise<void> => removeDatabase(dbPath);
const open = (): ReturnType<typeof openFixtureDatabase> =>
  openFixtureDatabase(dbPath);

beforeEach(remove);
afterAll(remove);

test("a rewritten object's artifact reference follows its new bytes", async () => {
  // The schema treats a differing digest as two producers disagreeing, not as
  // an update — so leaving the old one behind both lies and primes a conflict.
  const db = await open();
  await db.exec(
    `CREATE TABLE "MatchObservation" ("riotMatchId" TEXT PRIMARY KEY, "matchObjectKey" TEXT, "matchDigest" TEXT, "timelineObjectKey" TEXT, "timelineDigest" TEXT)`,
  );
  await db.exec(
    `INSERT INTO "MatchObservation" VALUES ('NA1_1', 'games/a/match.json', 'oldmatch', 'games/a/timeline.json', 'oldtimeline')`,
  );
  const { recordRewrittenDigest } = await import("./observations.ts");
  await recordRewrittenDigest(db, "games/a/match.json", "newmatch");
  await recordRewrittenDigest(db, "games/a/timeline.json", "newtimeline");
  const rows = await db.query(
    `SELECT "matchDigest" AS m, "timelineDigest" AS t FROM "MatchObservation"`,
  );
  expect(rows[0]?.["m"]).toBe("newmatch");
  expect(rows[0]?.["t"]).toBe("newtimeline");
  await db.close();
});

test("an unrelated observation is left alone", async () => {
  const db = await open();
  await db.exec(
    `CREATE TABLE "MatchObservation" ("riotMatchId" TEXT PRIMARY KEY, "matchObjectKey" TEXT, "matchDigest" TEXT, "timelineObjectKey" TEXT, "timelineDigest" TEXT)`,
  );
  await db.exec(
    `INSERT INTO "MatchObservation" VALUES ('NA1_2', 'games/b/match.json', 'keepme', NULL, NULL)`,
  );
  const { recordRewrittenDigest } = await import("./observations.ts");
  await recordRewrittenDigest(db, "games/a/match.json", "newmatch");
  const rows = await db.query(
    `SELECT "matchDigest" AS m FROM "MatchObservation"`,
  );
  expect(rows[0]?.["m"]).toBe("keepme");
  await db.close();
});

test("a database that does not model observations is not an error", async () => {
  // Prod's older schema has no MatchObservation at all, and the rewrite still
  // has to run there.
  const db = await open();
  await db.exec(`CREATE TABLE "Unrelated" ("id" INTEGER PRIMARY KEY)`);
  const { hasObservations } = await import("./observations.ts");
  expect(await hasObservations(db)).toBe(false);
  await db.close();
});
