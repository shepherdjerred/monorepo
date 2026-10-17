import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function committedRetry() {
  const db = cluster.database;
  const f = await fileFixture(db);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Missing committed plan");
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: entry.assetId },
  });
  await db.mediaIntent.update({
    where: { mediaId: f.media.id },
    data: { generation: 1 },
  });
  await db.acquisitionAttempt.update({
    where: { id: attempt.id },
    data: { generations: { [f.media.id]: 1 } },
  });
  await db.acquisitionReservation.update({
    where: { mediaId: f.media.id },
    data: { generation: 1 },
  });
  return { ...f, acquired, activities, attempt, entry, asset };
}

test("committed Retry accepts adopted generations and compatible profiles without repeating file effects", async () => {
  const f = await committedRetry();
  const db = cluster.database;
  const compatible = await db.qualityProfile.create({
    data: {
      name: "Compatible current profile",
      rules: QualityRulesSchema.parse(f.profile.rules),
    },
  });
  await db.mediaIntent.update({
    where: { mediaId: f.media.id },
    data: { profileId: compatible.id },
  });
  await rm(nodePath.join(f.roots.downloads, f.entry.downloadPath));
  f.context.inspect = () =>
    Promise.reject(new Error("Committed files must not be staged again"));
  f.context.checkpoint = (phase) =>
    phase === "committed-publication-verification"
      ? Promise.resolve()
      : Promise.reject(new Error(`Unexpected filesystem effect: ${phase}`));
  expect(await f.activities.inspectAndStageMedia(f.acquired.input)).toEqual({
    status: "staged",
  });
  expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "published",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.attempt.id },
  });
  expect(attempt).toMatchObject({
    state: "imported",
    generations: { [f.media.id]: 1 },
    filePlan: f.attempt.filePlan,
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(await readFile(f.asset.path, "utf8")).toBe(f.acquired.content);
  expect(
    await db.acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(1);
});

test("committed Retry with removed intent stays imported and preserves recovery ownership", async () => {
  const f = await committedRetry();
  await cluster.database.mediaIntent.update({
    where: { mediaId: f.media.id },
    data: { desiredPresence: false },
  });
  expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "obsolete",
    reason: "intent_obsolete",
  });
  expect(
    await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({ state: "imported", filePlan: f.attempt.filePlan });
  expect(
    await cluster.database.acquisitionReservation.count({
      where: { attemptId: f.attempt.id },
    }),
  ).toBe(1);
  expect(await readFile(f.asset.path, "utf8")).toBe(f.acquired.content);
});

test("committed Retry rejects current profiles that no longer accept the measured release", async () => {
  const f = await committedRetry();
  const rules = QualityRulesSchema.parse(f.profile.rules);
  const incompatible = await cluster.database.qualityProfile.create({
    data: {
      name: "Different audio policy",
      rules: { ...rules, requiredAudioLanguages: ["ja"] },
    },
  });
  await cluster.database.mediaIntent.update({
    where: { mediaId: f.media.id },
    data: { profileId: incompatible.id },
  });
  expect(await f.activities.inspectAndStageMedia(f.acquired.input)).toEqual({
    status: "blocked",
    reason: "committed_profile_rejected",
  });
  expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "blocked",
    reason: "committed_profile_rejected",
  });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
  ).toEqual(f.asset);
});

test.each([
  { owned: false },
  { state: "quarantined" },
  { checksum: "b".repeat(64) },
  { path: "/different/asset.mkv" },
])("committed Retry protects mutated asset authority %j", async (data) => {
  const f = await committedRetry();
  await cluster.database.libraryAsset.update({
    where: { id: f.asset.id },
    data,
  });
  expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "blocked",
    reason: "committed_asset_changed",
  });
  expect(
    await cluster.database.acquisitionReservation.count({
      where: { attemptId: f.attempt.id },
    }),
  ).toBe(1);
});

test("committed Retry protects missing current coverage and actual filesystem corruption", async () => {
  const f = await committedRetry();
  await cluster.database.assetCoverage.updateMany({
    where: { assetId: f.asset.id },
    data: { current: false },
  });
  expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "blocked",
    reason: "committed_asset_changed",
  });
  await cluster.database.assetCoverage.updateMany({
    where: { assetId: f.asset.id },
    data: { current: true },
  });
  await writeFile(f.asset.path, "X".repeat(f.acquired.content.length));
  expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "blocked",
    reason: "committed_file_changed",
  });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
  ).toEqual(f.asset);
});

test("hashing leaves authority rows unlocked and rejects an intent changed before final validation", async () => {
  const f = await committedRetry();
  const hashing = Promise.withResolvers<undefined>();
  const continueHash = Promise.withResolvers<undefined>();
  let paused = false;
  f.context.checkpoint = async (phase) => {
    if (phase === "committed-publication-verification" && !paused) {
      paused = true;
      hashing.resolve(undefined);
      await continueHash.promise;
    }
  };
  const publication = f.activities.promoteMediaFiles(f.acquired.input);
  await hashing.promise;
  try {
    // This must commit while hashing remains paused. A row lock held by hashing fails here.
    await cluster.database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
      await tx.mediaIntent.update({
        where: { mediaId: f.media.id },
        data: { desiredPresence: false, generation: { increment: 1 } },
      });
    });
  } finally {
    continueHash.resolve(undefined);
  }
  expect(await publication).toEqual({
    status: "obsolete",
    reason: "intent_obsolete",
  });
  expect(
    await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({ state: "imported", filePlan: f.attempt.filePlan });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
  ).toEqual(f.asset);
  expect(await readFile(f.asset.path, "utf8")).toBe(f.acquired.content);
});
