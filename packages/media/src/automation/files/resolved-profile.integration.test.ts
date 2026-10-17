import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { importResolvedProfiles } from "#migration/profile-import.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import {
  storedMeasuredRelease,
  assertMeasuredUpgrade,
} from "./quality-guard.ts";

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
test("real inspection/promotion uses resolved quality and preserves measured evidence for final guards", async () => {
  const db = cluster.database;
  const f = await fileFixture(db);
  directories.push(f.directory);
  const resolved = importResolvedProfiles(snapshot)[0]?.profiles.find(
    (profile) => profile.profile.name === "Best Available",
  );
  if (resolved === undefined) throw new Error("Fixture profile missing");
  // Tiny physical fixture has explicit size-free policy; all source quality group/cutoff semantics remain intact.
  for (const definition of resolved.qualityDefinitions) {
    definition.minSize = 0;
    definition.maxSize = 0;
  }
  resolved.profile.language = { id: -2, name: "Original" };
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { originalLanguage: "en", runtimeMinutes: 2 },
  });
  const rules = { ...QualityRulesSchema.parse(f.profile.rules), resolved };
  await db.qualityProfile.update({
    where: { id: f.profile.id },
    data: { rules },
  });
  const acquired = await f.acquisition();
  await db.releaseCandidate.update({
    where: { id: acquired.attempt.releaseId },
    data: { title: "Test.Film.2026.1080p.WEB-DL.H264-GROUP" },
  });
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Missing plan");
  const measured = storedMeasuredRelease(entry.properties);
  expect(measured.resolvedEvidence?.release).toMatchObject({
    qualityId: 3,
    originalLanguage: "en",
    audioLanguages: ["en"],
    runtimeMinutes: 2,
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  expect(
    await assertMeasuredUpgrade(db, measured, [f.media.id], entry.assetId),
  ).toEqual({ [f.media.id]: 0 });
  // A current profile edit is evaluated from measured evidence, never the old candidate's tags.
  resolved.profile.minFormatScore = 1;
  await db.qualityProfile.update({
    where: { id: f.profile.id },
    data: { rules: { ...rules, resolved } },
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "blocked",
    reason: "committed_profile_rejected",
  });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: entry.assetId },
  });
  expect(asset.version).toBe(0);
  await db.mediaRequest.update({
    where: { id: f.request.id },
    data: { excluded: true },
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "obsolete",
    reason: "request_obsolete",
  });
});
