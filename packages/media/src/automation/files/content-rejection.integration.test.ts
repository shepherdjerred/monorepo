import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "./test-support.ts";
import {
  MeasuredContentRejection,
  measuredQualityError,
  rejectUnstagedContentV1,
} from "./content-rejection.ts";
import {
  PublicReleaseAttributesSchema,
  QualityRulesSchema,
} from "#shared/api.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { providerCandidateAdmission } from "#automation/provider-selection.ts";

const h = automationTestHarness(),
  directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("a definitive unstaged content rejection retains the transfer, releases only its reservations, and allows another source", async () => {
  const db = h.database(),
    f = await fileFixture(db);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
    include: { release: true, torrent: true },
  });
  if (attempt.torrent === null)
    throw new Error("Missing owned fixture transfer");
  await db.mediaProvider.upsert({
    where: { id: attempt.release.providerId },
    create: {
      id: attempt.release.providerId,
      enabled: true,
      seedingPolicy: { kind: "public" },
    },
    update: { enabled: true },
  });
  await db.releaseCandidate.update({
    where: { id: attempt.releaseId },
    data: { sourceEvidence: { infoHash: attempt.torrent.infoHash } },
  });
  await db.acquisitionAttempt.update({
    where: { id: attempt.id },
    data: {
      state: "validating",
      failure: { profileId: f.profile.id, profileVersion: f.profile.version },
    },
  });
  const profile = {
    id: f.profile.id,
    version: f.profile.version,
    ...QualityRulesSchema.parse(f.profile.rules),
  };
  const measured = {
    id: attempt.releaseId,
    providerId: attempt.release.providerId,
    title: attempt.release.title,
    ...PublicReleaseAttributesSchema.parse(attempt.release.attributes),
    quality: "WEB-720p",
    codec: "H264",
  };
  const error = measuredQualityError(
    measured,
    profile,
    f.media.id,
    evaluateRelease(measured, profile, [f.media.id]),
  );
  if (!(error instanceof MeasuredContentRejection))
    throw new TypeError("Measured bad quality was not definitive");
  expect(
    await db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      return rejectUnstagedContentV1(tx, attempt.id, error);
    }),
  ).toBe(true);
  expect(
    await db.acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(0);
  expect(
    await db.torrent.findUniqueOrThrow({ where: { id: attempt.torrent.id } }),
  ).toEqual(attempt.torrent);
  expect(
    await db.operation.findFirstOrThrow({
      where: {
        idempotencyKey: { startsWith: `content-rejection:${attempt.id}:` },
      },
    }),
  ).toMatchObject({ kind: "reconcile_movie_edition_v4", targetId: f.media.id });
  const admission = await providerCandidateAdmission(h.context(), {
    releaseId: attempt.releaseId,
    mediaId: f.media.id,
    profile,
    rank: 0,
  });
  expect(admission.reason).toBe("release_previously_rejected");
  const alternative = await db.releaseCandidate.create({
    data: {
      providerId: attempt.release.providerId,
      providerReleaseId: crypto.randomUUID(),
      title: attempt.release.title,
      attributes: PublicReleaseAttributesSchema.parse(
        attempt.release.attributes,
      ),
      evaluation: {},
      mediaIds: attempt.mediaIds,
    },
  });
  const admittedAlternative = await providerCandidateAdmission(h.context(), {
    releaseId: alternative.id,
    mediaId: f.media.id,
    profile,
    rank: 0,
  });
  expect(admittedAlternative.accepted).toBe(true);
  expect(
    await db.libraryAsset.count({
      where: { coverage: { some: { mediaId: f.media.id } } },
    }),
  ).toBe(0);
});
