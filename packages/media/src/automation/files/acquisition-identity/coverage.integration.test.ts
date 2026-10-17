import { afterEach, expect, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(filename: string) {
  const db = harness.database();
  const f = await identityFixture(db, harness.context(), true);
  directories.push(f.files.directory);
  const second = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Second episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: {
        absoluteNumber: 124,
        numberingEvidence: "Owner verified episode 124",
        seriesTmdb: f.series.tmdbId,
        plexSectionId: "2",
      },
    },
  });
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(second.id)], {
      createMissing: true,
    });
    await tx.mediaIntent.update({
      where: targetWhere(defaultScope(second.id)),
      data: {
        profileId: f.files.profile.id,
        automationEpoch: 0,
        desiredPresence: true,
        monitoring: true,
      },
    });
    await tx.mediaRequest.create({
      data: { mediaId: second.id, userId: f.actor.id },
    });
  });
  f.source.title = "Example Show - 123-124 1080p WEB-DL H264 ENG";
  f.source.providerReleaseId = crypto.randomUUID();
  const profile = await loadProfile(db, f.files.media.id);
  if (profile === null) throw new Error("Missing test profile");
  await searchCandidates(f.network, f.files.media.id, profile);
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: {
      providerId_providerReleaseId: {
        providerId: f.source.providerId,
        providerReleaseId: f.source.providerReleaseId,
      },
    },
  });
  const preview = await f.service.identityPreview(
    f.actor,
    f.files.media.id,
    release.id,
    { mediaIds: [f.files.media.id, second.id] },
  );
  const selected = await f.service.act(
    f.actor,
    crypto.randomUUID(),
    f.files.media.id,
    {
      action: "select_release",
      releaseId: release.id,
      expectedVersion:
        preview.media.find((item) => item.id === f.files.media.id)?.version ??
        -1,
      identityConfirmation: {
        candidateDigest: preview.candidateDigest,
        previewDigest: preview.previewDigest,
        numberingDigest: preview.numberingDigest,
        mediaIds: preview.media.map((item) => item.id),
        reason:
          "Owner verified the two canonical episodes in this combined release",
        acknowledgeIdentity: true,
      },
    },
  );
  const operationId = z.uuid().parse(selected.operationId);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const command = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.number(),
    })
    .parse(operation.payload);
  const acquisition = createAcquisitionActivities(f.network);
  const result = await acquisition.reconcileMediaIntent(command);
  expect(result.status).toBe("acquire");
  const attemptId = z.uuid().parse(result.attemptId);
  const input = { attemptId, operationId };
  const submission = await acquisition.submitMediaTorrent(input);
  expect(submission.status).toBe("submitted");
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  await writeFile(
    path.join(f.files.roots.downloads, filename),
    "Fixture media bytes!",
  );
  await db.torrent.update({
    where: { id: z.uuid().parse(attempt.torrentId) },
    data: {
      state: "ready",
      observation: {
        torrent: { progress: 1, save_path: f.files.roots.downloads },
        files: [{ index: 0, name: filename, size: 20, progress: 1 }],
      },
    },
  });
  await db.acquisitionAttempt.update({
    where: { id: attemptId },
    data: { state: "ready" },
  });
  return { ...f, second, input };
}

test("one absolute-range video publishes exact shared canonical coverage", async () => {
  const f = await fixture("Example Show - 123-124.mkv");
  const activities = createMediaFileActivities(f.files.context);
  expect(await activities.inspectAndStageMedia(f.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(f.input)).toEqual({
    status: "published",
  });
  const attempt = await harness
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.input.attemptId } });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  expect(plan).toHaveLength(1);
  expect(plan[0]?.mediaIds.toSorted()).toEqual(
    [f.files.media.id, f.second.id].toSorted(),
  );
  expect(plan[0]?.libraryPath).toContain("S01E01-E02");
  expect(
    await harness.database().assetCoverage.count({
      where: { assetId: z.uuid().parse(plan[0]?.assetId), current: true },
    }),
  ).toBe(2);
});

test.each([
  ["Unnumbered Feature.mkv", "coordinate_unknown"],
  ["Example Show S01E01 ( - 124 ).mkv", "coordinate_conflict"],
  ["Example Show - 123-125.mkv", "coordinate_unmapped"],
])(
  "a reviewed release cannot authorize incompatible physical file %s",
  async (filename, reason) => {
    const f = await fixture(filename);
    expect(
      await createMediaFileActivities(f.files.context).inspectAndStageMedia(
        f.input,
      ),
    ).toEqual({ status: "blocked", reason });
    expect(
      await harness.database().libraryAsset.count({
        where: {
          coverage: {
            some: { mediaId: { in: [f.files.media.id, f.second.id] } },
          },
        },
      }),
    ).toBe(0);
  },
);
