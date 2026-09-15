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

/**
 * Receipt evidence built the way the producer builds it.
 *
 * These tests construct evidence through `rawArchiveEvidenceCodec` rather than
 * by hand. A hand-written fixture is what let the first version of
 * `repointReceipts` ship broken: it agreed with the walker's invented
 * `{ key, payload }` shape, so a no-op passed. Anything the reader would refuse
 * is refused here too.
 */
async function evidenceFor(key: string, digest: string): Promise<string> {
  const { rawArchiveEvidenceCodec } =
    await import("@scout-for-lol/backend/report-lake/durable-receipts.ts");
  return JSON.stringify(
    rawArchiveEvidenceCodec.serialize(
      rawArchiveEvidenceCodec.parse({
        kind: rawArchiveEvidenceCodec.kind,
        version: rawArchiveEvidenceCodec.version,
        data: {
          kind: "prematch",
          key,
          digest,
          bytes: 1234,
          contentType: "application/json",
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
      }),
    ),
  );
}

const OLD_DIGEST = "a".repeat(64);
const NEW_DIGEST = "b".repeat(64);

async function receiptTable(db: Awaited<ReturnType<typeof open>>) {
  // Integer ids, as both targets really have them: prod's SQLite hands back a
  // number and beta's Postgres a BigInt for the same `BigInt @id` column. A
  // TEXT id here would pass while proving nothing about either.
  await db.exec(
    `CREATE TABLE "MatchProcessingReceipt" ("id" INTEGER PRIMARY KEY, "kind" TEXT, "evidence" TEXT)`,
  );
}

test("a raw-archive receipt attests the bytes now under its key", async () => {
  // The regression that matters: the descriptor lives under the envelope's
  // `data`, and a walker looking for `payload` moved nothing at all while
  // reporting success.
  const db = await open();
  await receiptTable(db);
  await db.exec(
    `INSERT INTO "MatchProcessingReceipt" VALUES (1, 'raw-archive-prematch', ${db.param(1)})`,
    [await evidenceFor("prematch/a.json", OLD_DIGEST)],
  );
  const { repointReceipts } = await import("./observations.ts");
  expect(await repointReceipts(db, "prematch/a.json", NEW_DIGEST)).toBe(1);

  const rows = await db.query(
    `SELECT "evidence" AS e FROM "MatchProcessingReceipt" WHERE "id" = 1`,
  );
  const { rawArchiveEvidenceCodec } =
    await import("@scout-for-lol/backend/report-lake/durable-receipts.ts");
  // Parsed with the reader's codec: a receipt the reader cannot read is not a
  // moved receipt, however right the digest looks in the JSON.
  const descriptor = rawArchiveEvidenceCodec.parse(
    JSON.parse(String(rows[0]?.["e"])),
  );
  expect(descriptor.digest).toBe(NEW_DIGEST);
  expect(descriptor.bytes).toBe(1234);
  expect(descriptor.capturedAt).toBe("2026-09-01T00:00:00.000Z");
  await db.close();
});

test("a receipt for another object keeps its digest", async () => {
  // `LIKE '%key%'` matches on substrings, so a shorter key can select a
  // receipt describing a different object.
  const db = await open();
  await receiptTable(db);
  await db.exec(
    `INSERT INTO "MatchProcessingReceipt" VALUES (2, 'raw-archive-prematch', ${db.param(1)})`,
    [await evidenceFor("prematch/a.json.backup", OLD_DIGEST)],
  );
  const { repointReceipts } = await import("./observations.ts");
  expect(await repointReceipts(db, "prematch/a.json", NEW_DIGEST)).toBe(0);
  const rows = await db.query(
    `SELECT "evidence" AS e FROM "MatchProcessingReceipt" WHERE "id" = 2`,
  );
  expect(String(rows[0]?.["e"])).toContain(OLD_DIGEST);
  await db.close();
});

test("a staging receipt is left alone, being a record of the past", async () => {
  const db = await open();
  await receiptTable(db);
  await db.exec(
    `INSERT INTO "MatchProcessingReceipt" VALUES (3, 'lake-staging-match', ${db.param(1)})`,
    [await evidenceFor("prematch/a.json", OLD_DIGEST)],
  );
  const { repointReceipts } = await import("./observations.ts");
  expect(await repointReceipts(db, "prematch/a.json", NEW_DIGEST)).toBe(0);
  const rows = await db.query(
    `SELECT "evidence" AS e FROM "MatchProcessingReceipt" WHERE "id" = 3`,
  );
  expect(String(rows[0]?.["e"])).toContain(OLD_DIGEST);
  await db.close();
});

test("evidence the reader could not read stops the rewrite", async () => {
  // Skipping it would leave a live claim pointing at bytes that no longer
  // exist, which is the failure this whole function exists to prevent.
  const db = await open();
  await receiptTable(db);
  await db.exec(
    `INSERT INTO "MatchProcessingReceipt" VALUES (4, 'raw-archive-match', ${db.param(1)})`,
    [JSON.stringify({ key: "games/a/match.json", digest: OLD_DIGEST })],
  );
  const { repointReceipts } = await import("./observations.ts");
  await expect(
    repointReceipts(db, "games/a/match.json", NEW_DIGEST),
  ).rejects.toThrow();
  await db.close();
});

test("a database without receipts is not an error", async () => {
  const db = await open();
  await db.exec(`CREATE TABLE "Unrelated2" ("id" INTEGER PRIMARY KEY)`);
  const { hasReceipts } = await import("./observations.ts");
  expect(await hasReceipts(db)).toBe(false);
  await db.close();
});
