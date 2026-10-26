import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { plexBindingFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("ordinary publication commits complete serving claims with availability and finalizes only bound coverage", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context(), {
    publicationPending: true,
  });
  directories.push(f.files.directory);
  const original = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.published.attempt.id },
  });
  expect(f.asset.plexPublishedAt).toBeNull();
  const activities = createPublicationActivities(f.context);
  expect(await activities.publishMediaToPlex(f.published.input)).toEqual({
    status: "available",
    reason: null,
  });
  const reads = await db.$transaction((tx) =>
    readCurrentPlexBindings(tx, [
      {
        scope: { mediaId: f.files.media.id, edition: "default" },
        assetId: f.asset.id,
        access: {
          serverMachineId: "fixture-server",
          sectionId: "1",
          sectionType: "movie",
        },
      },
    ]),
  );
  expect(reads).toHaveLength(1);
  expect(reads[0]?.status).toBe("current");
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.files.media.id } }),
  ).toMatchObject({ availability: "available" });
  const stamped = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(stamped.plexPublishedAt).not.toBeNull();
  await activities.finalizeMediaAcquisition(f.published.input);
  const finalized = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: original.id },
  });
  expect(finalized).toMatchObject({
    state: "completed",
    filePlan: original.filePlan,
    identityEvidence: original.identityEvidence,
    movieEditionChoiceId: original.movieEditionChoiceId,
    movieEditionAuthority: original.movieEditionAuthority,
  });
  expect(
    await db.acquisitionReservation.count({
      where: { attemptId: original.id },
    }),
  ).toBe(0);
  const replayedAsset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(replayedAsset.plexPublishedAt).toEqual(stamped.plexPublishedAt);
});

test("metadata replacement after discovery leaves physical bytes importing and cannot finalize availability alone", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context(), {
    publicationPending: true,
  });
  directories.push(f.files.directory);
  const before = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.files.media.id },
  });
  f.item.Media[0]?.Part.push({
    id: 601,
    file: f.asset.path,
    size: Number(f.asset.sizeBytes),
  });
  const activities = createPublicationActivities(f.context);
  expect(await activities.publishMediaToPlex(f.published.input)).toEqual({
    status: "blocked",
    reason: "unsupported_media_parts",
  });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.files.media.id } }),
  ).toEqual(before);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(
    await db.plexBindingCurrent.count({ where: { mediaId: f.files.media.id } }),
  ).toBe(0);
  // A stale pre-binding display bit is not a serving grant.
  await db.mediaItem.update({
    where: { id: f.files.media.id },
    data: { availability: "available" },
  });
  await expect(
    activities.finalizeMediaAcquisition(f.published.input),
  ).rejects.toMatchObject({ reason: "missing_binding" });
  const importedAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.published.attempt.id },
  });
  expect(importedAttempt.state).toBe("imported");
  expect(
    await db.acquisitionReservation.count({
      where: { attemptId: f.published.attempt.id },
    }),
  ).toBe(1);
});
