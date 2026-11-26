import { rm } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  automationTestHarness,
  ensureTestProvider,
} from "#testing/automation.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { loadProfile } from "#automation/acquisition-candidates.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { tvBindingContext } from "#automation/plex-binding/tv.test-fixture.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { readProviderCandidateAdmission } from "#automation/provider-selection.ts";
import { acquisitionIdentity } from "#infrastructure/acquisition-identity/acquisition.ts";
import { TorrentObservationSchema } from "#integrations/qbittorrent.ts";
import type { Database } from "#infrastructure/database.ts";

const h = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const blocked = { status: "blocked", reason: "torrent_ownership_conflict" };
const settled = {
  status: "obsolete",
  reason: "compensated_season_source_retained",
};

test("a compensated season's retained source blocks new selection and releases only its proven unsubmitted duplicate", async () => {
  const f = await duplicateFixture();
  const admission = (releaseId: string, mediaIds?: string[]) =>
    readProviderCandidateAdmission(f.context, {
      releaseId,
      mediaId: f.file.media.id,
      profile: f.profile,
      rank: 0,
      ...(mediaIds === undefined ? {} : { mediaIds }),
    });
  expect(await admission(f.release.id)).toMatchObject({
    accepted: false,
    reason: settled.reason,
  });
  expect(await admission(f.release.id, [f.file.media.id])).toMatchObject({
    accepted: true,
  });
  const replacement = await f.createRelease("b".repeat(40));
  expect(await admission(replacement.id)).toMatchObject({ accepted: true });

  const activities = createAcquisitionActivities(f.context);
  let operationId = f.duplicate.operationId;
  const submit = () =>
    activities.submitMediaTorrent({ attemptId: f.duplicate.id, operationId });
  for (const observation of [{ ...f.observation, tags: "foreign" }, null]) {
    f.observe.mockResolvedValueOnce(observation);
    expect(await submit()).toEqual(blocked);
    expect(await f.reservationCount()).toBe(2);
  }
  await f.db.acquisitionAttempt.update({
    where: { id: f.duplicate.id },
    data: { state: "submission_unknown" },
  });
  expect(await submit()).toEqual(blocked);
  expect(await f.reservationCount()).toBe(2);
  await f.db.acquisitionAttempt.update({
    where: { id: f.duplicate.id },
    data: { state: "reserved" },
  });
  const key = {
    mediaId_edition: { mediaId: f.file.media.id, edition: "default" },
  };
  const reservation = await f.db.acquisitionReservation.findUniqueOrThrow({
    where: key,
  });
  await f.db.acquisitionReservation.update({
    where: key,
    data: { generation: { increment: 1 } },
  });
  expect(await submit()).toEqual(blocked);
  expect(await f.reservationCount()).toBe(2);
  await f.db.acquisitionReservation.update({
    where: key,
    data: { generation: reservation.generation },
  });
  const next = await f.adoptOtherEpisode(activities);
  operationId = next.operationId;
  expect(await submit()).toEqual(settled);
  expect(await f.reservationCount()).toBe(0);
  const observed = f.observe.mock.calls.length;
  expect(await submit()).toEqual(settled);
  expect(f.observe).toHaveBeenCalledTimes(observed);
  expect(f.add).not.toHaveBeenCalled();
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.original.id },
    }),
  ).toEqual(f.original);
  expect(
    await f.db.torrent.findUniqueOrThrow({
      where: { id: f.torrent.id },
    }),
  ).toEqual(f.torrent);
  expect(
    await f.db.mediaItem.count({
      where: { id: { in: f.release.mediaIds }, availability: "available" },
    }),
  ).toBe(2);
  expect(
    await f.db.mediaIntent.count({
      where: {
        mediaId: { in: f.release.mediaIds },
        edition: "default",
        availability: "available",
      },
    }),
  ).toBe(2);
  expect(await f.unchangedServingState()).toEqual(f.servingBefore);
});

async function duplicateFixture() {
  const db = h.database();
  const file = await sharedTvFileFixture(db, mappedPublicationFixture);
  directories.push(file.directory);
  const serving = await file.acquisition();
  const physical = createMediaFileActivities(file.context);
  expect(await physical.inspectAndStageMedia(serving.input)).toMatchObject({
    status: "staged",
  });
  expect(await physical.promoteMediaFiles(serving.input)).toMatchObject({
    status: "published",
  });
  const mediaIds = serving.attempt.mediaIds.toSorted();
  const tv = await tvBindingContext(db, h.context(), mediaIds);
  const published = createPublicationActivities(tv.context);
  expect(await published.publishMediaToPlex(serving.input)).toMatchObject({
    status: "available",
  });
  await published.finalizeMediaAcquisition(serving.input);
  const servingAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: serving.attempt.id },
  });
  const originalPlan = z
    .array(z.record(z.string(), z.json()))
    .parse(servingAttempt.filePlan)
    .map((entry) => ({
      ...entry,
      assetId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
    }));
  await db.qualityProfileVersion.create({
    data: {
      profileId: file.profile.id,
      version: file.profile.version,
      rules: z.record(z.string(), z.json()).parse(file.profile.rules),
    },
  });
  const profile = await loadProfile(db, file.media.id);
  if (profile === null) throw new Error("Test episode has no profile");
  const hash = crypto.randomUUID().replaceAll("-", "") + "01234567";
  const attributes = {
    mediaIds,
    identityConfidence: "exact",
    quality: "WEB-2160p",
    codec: "H264",
    audioLanguages: ["en"],
    sizeBytes: 1000,
    scoreTags: [],
  };
  await ensureTestProvider(db);
  const createRelease = (infoHash: string) =>
    seasonRelease(tv.context, { attributes, infoHash });
  const release = await createRelease(hash);
  const torrent = await db.torrent.create({
    data: {
      infoHash: hash,
      qbittorrentId: hash,
      providerId: release.providerId,
      owned: true,
      ownershipEpoch: 0,
      state: "seeding",
      seedingPolicy: { kind: "public" },
    },
  });
  const operation = (status: "completed" | "running") =>
    db.operation.create({
      data: {
        kind: "reconcile_media",
        status,
        targetId: file.media.id,
        payload: {},
      },
    });
  const originalOperation = await operation("completed");
  const duplicateOperation = await operation("running");
  const identityEvidence = await db.$transaction((tx) =>
    acquisitionIdentity(tx, release, {
      operationId: duplicateOperation.id,
      sponsorRequestId: file.request.id,
      epoch: 0,
      mediaIds,
      serverMachineId: "fixture-server",
    }),
  );
  const targets = await db.mediaIntent.findMany({
    where: { mediaId: { in: mediaIds }, edition: "default" },
  });
  const common = {
    releaseId: release.id,
    mediaIds,
    generations: Object.fromEntries(
      targets.map((target) => [target.mediaId, target.generation]),
    ),
    sponsorRequestId: file.request.id,
    identityEvidence: z.record(z.string(), z.json()).parse(identityEvidence),
    recoveryEpoch: 0,
  };
  const original = await db.acquisitionAttempt.create({
    data: {
      ...common,
      state: "obsolete",
      failure: { reason: "publication_compensated" },
      operationId: originalOperation.id,
      torrentId: torrent.id,
      filePlan: originalPlan,
    },
  });
  const duplicate = await db.acquisitionAttempt.create({
    data: {
      ...common,
      state: "reserved",
      failure: { profileId: profile.id, profileVersion: profile.version },
      operationId: duplicateOperation.id,
      coordinatorOperationId: duplicateOperation.id,
      reservations: {
        create: targets.map((target) => ({
          mediaId: target.mediaId,
          generation: target.generation,
        })),
      },
    },
  });
  await db.mediaItem.update({
    where: { id: file.media.id },
    data: { availability: "searching" },
  });
  await db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: file.media.id, edition: "default" } },
    data: { availability: "searching" },
  });
  const unchangedServingState = () => servingState(db, mediaIds);
  return {
    db,
    file,
    context: tv.context,
    ...mockRetainedTorrent(tv.context, original, {
      hash,
      title: release.title,
      size: attributes.sizeBytes,
    }),
    profile,
    release,
    createRelease,
    original,
    duplicate,
    torrent,
    unchangedServingState,
    servingBefore: await unchangedServingState(),
    adoptOtherEpisode: (
      activities: ReturnType<typeof createAcquisitionActivities>,
    ) => adoptOtherEpisode(db, activities, duplicate, file.media.id),
    reservationCount: () =>
      db.acquisitionReservation.count({ where: { attemptId: duplicate.id } }),
  };
}

async function servingState(db: Database, mediaIds: string[]) {
  return {
    bindings: await db.plexBindingCurrent.findMany({
      where: { mediaId: { in: mediaIds } },
      orderBy: { mediaId: "asc" },
    }),
    assets: await db.libraryAsset.findMany({
      where: { coverage: { some: { mediaId: { in: mediaIds } } } },
      include: { subtitles: true },
      orderBy: { id: "asc" },
    }),
  };
}

async function adoptOtherEpisode(
  db: Database,
  activities: ReturnType<typeof createAcquisitionActivities>,
  attempt: AcquisitionAttempt,
  primary: string,
) {
  const mediaId = z.uuid().parse(attempt.mediaIds.find((id) => id !== primary));
  const { generation } = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId, edition: "default" } },
  });
  await db.operation.update({
    where: { id: attempt.operationId },
    data: { status: "reconciling" },
  });
  const operation = await db.operation.create({
    data: { kind: "reconcile_media", targetId: mediaId, payload: {} },
  });
  const input = { operationId: operation.id, mediaId, generation };
  expect(await activities.reconcileMediaIntent(input)).toMatchObject({
    status: "acquire",
    attemptId: attempt.id,
  });
  return input;
}

async function seasonRelease(
  { db, cipher }: MediaAutomationContext,
  input: {
    infoHash: string;
    attributes: Prisma.InputJsonObject & {
      mediaIds: string[];
      sizeBytes: number;
    };
  },
) {
  const { infoHash, attributes } = input;
  const source = {
    providerId: "knaben",
    providerReleaseId: crypto.randomUUID(),
    title: "Coastlines.2026.S01.2160p.WEB-DL.H264.ENG",
    sizeBytes: attributes.sizeBytes,
    seeders: 2,
    infoHash,
    detailsUrl: "https://provider.fixture/details",
    download: { kind: "magnet", value: `magnet:?xt=urn:btih:${infoHash}` },
  };
  const { providerId, providerReleaseId, title } = source;
  return db.releaseCandidate.create({
    data: {
      providerId,
      providerReleaseId,
      title,
      mediaIds: attributes.mediaIds,
      attributes,
      sourceEvidence: { infoHash },
      evaluation: {},
      encryptedSource: cipher.encrypt(
        JSON.stringify(source),
        `release:${providerId}:${providerReleaseId}`,
      ),
    },
  });
}

function mockRetainedTorrent(
  { qbittorrent }: MediaAutomationContext,
  original: AcquisitionAttempt,
  { hash, title, size }: { hash: string; title: string; size: number },
) {
  const savePath = `/downloads/media/${original.id}`;
  const observation = TorrentObservationSchema.parse({
    hash,
    infohash_v1: hash,
    infohash_v2: "",
    name: title,
    size,
    state: "uploading",
    category: "media",
    tags: `media-${original.operationId},media-attempt-${original.id}`,
    save_path: savePath,
    content_path: `${savePath}/season`,
    progress: 1,
    ratio: 0.25,
    seeding_time: 100,
    ratio_limit: -1,
    seeding_time_limit: -1,
    inactive_seeding_time_limit: -1,
    max_ratio: -1,
    max_seeding_time: -1,
    max_inactive_seeding_time: -1,
    share_limit_action: "Stop",
    auto_tmm: false,
    force_start: false,
  });
  vi.spyOn(qbittorrent, "login").mockResolvedValue(undefined);
  const observe = vi
    .spyOn(qbittorrent, "observe")
    .mockResolvedValue(observation);
  const add = vi
    .spyOn(qbittorrent, "submit")
    .mockRejectedValue(new Error("Unexpected add"));
  return { observation, observe, add };
}
