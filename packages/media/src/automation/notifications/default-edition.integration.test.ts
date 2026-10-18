import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { queueLifecycleNotifications } from "./events.ts";
import { renderMediaMetrics } from "#infrastructure/metrics.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";

const h = automationTestHarness();
async function setup() {
  const f = await h.fixture();
  const db = h.database();
  const namedUser = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Named requester",
      email: "named@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  await grantTestRequesterAccess(db, namedUser.id, "fixture-server");
  await chooseTestMovieEdition(db, {
    actor: { ...namedUser, role: "member" },
    mediaId: f.media.id,
    edition: "extended_cut",
    access: { serverMachineId: "fixture-server", movieSectionId: "1" },
  });
  await db.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
    },
    data: { generation: 77 },
  });
  await db.mediaUser.update({
    where: { id: f.user.id },
    data: {
      email: "default@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: {
      availability: "available",
      externalIds: { plexRatingKey: "42", plexSectionId: "1" },
    },
  });
  const asset = await db.libraryAsset.create({
    data: {
      path: `/library/${f.media.id}.mkv`,
      editionRootId: f.media.id,
      sizeBytes: 10,
      checksum: "a".repeat(64),
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      plexPublishedAt: new Date(),
      properties: { releaseId: f.release.id },
      coverage: { create: { mediaId: f.media.id, current: true } },
    },
  });
  return { ...f, db, namedUser, asset };
}

test("default watch and notifications stay isolated while pending named demand protects automatic retention", async () => {
  const f = await setup();
  const namedWatch = await f.db.watchState.create({
    data: {
      mediaId: f.media.id,
      edition: "extended_cut",
      userId: f.user.id,
      watched: false,
      observedAt: new Date("2000-01-01T00:00:00Z"),
      source: "fixture",
    },
  });
  await f.db.retentionHold.create({
    data: {
      mediaId: f.media.id,
      edition: "extended_cut",
      userId: f.namedUser.id,
      isPin: true,
    },
  });
  const namedDecision = await f.db.retentionDecision.create({
    data: {
      mediaId: f.media.id,
      edition: "extended_cut",
      generation: 77,
      state: "warning_pending",
      evidence: {},
    },
  });
  await f.db.credential.create({
    data: {
      userId: f.user.id,
      kind: "plex",
      ciphertext: h.cipher.encrypt(
        JSON.stringify({ serverToken: "fixture" }),
        `plex:${f.user.plexAccountId}`,
      ),
    },
  });
  const ctx = h.context(async (url) =>
    Response.json({
      MediaContainer: url.pathname.endsWith("sessions")
        ? { size: 0 }
        : {
            size: 1,
            Metadata: [
              {
                ratingKey: "42",
                title: "Default",
                type: "movie",
                viewCount: 1,
              },
            ],
          },
    }),
  );
  expect(await observeRequesterWatch(ctx, f.media.id)).toEqual({
    complete: true,
    reason: null,
  });
  expect(
    await createRetentionActivities(ctx).evaluateMediaRetention(f.input),
  ).toMatchObject({
    status: "protected",
    reason: "edition_acquisition_not_ready",
  });
  expect(
    await f.db.watchState.findUnique({
      where: {
        userId_mediaId_edition: {
          mediaId: f.media.id,
          edition: "extended_cut",
          userId: f.user.id,
        },
      },
    }),
  ).toEqual(namedWatch);
  const defaultWatch = await f.db.watchState.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.media.id,
        edition: "default",
      },
    },
  });
  expect(await renderMediaMetrics(f.db)).toContain(
    `media_watch_evidence_oldest_timestamp_seconds ${String(defaultWatch.observedAt.getTime() / 1000)}\n`,
  );
  expect(
    await f.db.retentionDecision.findUnique({
      where: { id: namedDecision.id },
    }),
  ).toEqual(namedDecision);
  const before = await f.db.mediaIntent.findMany({
    where: { mediaId: f.media.id },
    orderBy: { edition: "asc" },
  });
  const subtitleWork = await currentSubtitleWork(f.db, f.asset.id, 0);
  const item = {
    mediaId: f.media.id,
    generation: 1,
    assetId: f.asset.id,
    assetVersion: 0,
    assetChecksum: "a".repeat(64),
  };
  await f.db.$transaction((tx) =>
    queueLifecycleNotifications(tx, {
      key: `default:${f.media.id}`,
      kind: "media_available",
      epoch: 0,
      items: [item],
    }),
  );
  expect(
    await f.db.notificationDelivery.count({
      where: { userId: f.namedUser.id },
    }),
  ).toBe(0);
  const event = await f.db.applicationEvent.findUniqueOrThrow({
    where: { dedupeKey: `default:${f.media.id}:item:${f.media.id}` },
  });
  expect(event.payload).toEqual({ ...item, recoveryEpoch: 0 });
  expect(
    await f.db.mediaIntent.findMany({
      where: { mediaId: f.media.id },
      orderBy: { edition: "asc" },
    }),
  ).toEqual(before);
  await f.db.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
    },
    data: { generation: { increment: 1 } },
  });
  const afterNamedChange = await currentSubtitleWork(f.db, f.asset.id, 0);
  expect(afterNamedChange.authority).toBe(subtitleWork.authority);
});

test("fresh named attempts are rejected and existing named artifacts protect shared source deletion even when terminal", async () => {
  const f = await setup();
  const request = await f.db.mediaRequest.findFirstOrThrow({
    where: { mediaId: f.media.id, edition: "extended_cut" },
  });
  const torrent = await f.db.torrent.create({
    data: {
      infoHash: f.source.infoHash,
      providerId: "knaben",
      owned: true,
      ownershipEpoch: 0,
      seedingPolicy: { kind: "public" },
      state: "seeding",
    },
  });
  await expect(
    f.db.acquisitionAttempt.create({
      data: {
        edition: "extended_cut",
        operationId: f.input.operationId,
        releaseId: f.release.id,
        sponsorRequestId: request.id,
        mediaIds: [f.media.id],
        generations: { [f.media.id]: 77 },
        state: "completed",
        torrentId: torrent.id,
        recoveryEpoch: 0,
      },
    }),
  ).rejects.toThrow(
    "New movie acquisition requires exact birth choice authority",
  );
  expect(
    await f.db.acquisitionAttempt.count({ where: { torrentId: torrent.id } }),
  ).toBe(0);
  const asset = await f.db.libraryAsset.create({
    data: {
      edition: "extended_cut",
      editionRootId: f.media.id,
      torrentId: torrent.id,
      path: `/library/${f.media.id}-extended.mkv`,
      sizeBytes: 10,
      checksum: "b".repeat(64),
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      properties: {},
      coverage: { create: { mediaId: f.media.id, current: true } },
    },
  });
  let calls = 0;
  const ctx = h.context(async () => {
    calls++;
    throw new Error("Unexpected external effect");
  });
  await expect(
    createSubtitleActivities(ctx).findMediaSubtitles({
      operationId: f.input.operationId,
      assetId: asset.id,
      language: "en",
    }),
  ).rejects.toThrow("edition_not_available");
  const decision = await f.db.retentionDecision.create({
    data: {
      mediaId: f.media.id,
      edition: "extended_cut",
      generation: 77,
      state: "restored",
      evidence: {},
    },
  });
  await f.db.operation.update({
    where: { id: f.input.operationId },
    data: {
      kind: "restore_media",
      result: {
        restoreReceipt: {
          decisionId: decision.id,
          mediaIds: [f.media.id],
          recoveryEpoch: 0,
          assets: [
            { assetId: asset.id, assetVersion: 0, checksum: "b".repeat(64) },
          ],
        },
      },
    },
  });
  await expect(
    createPublicationActivities(ctx).publishRestoredMedia(f.input),
  ).rejects.toThrow("edition_not_available");
  await f.db.libraryAsset.update({
    where: { id: asset.id },
    data: { state: "purged" },
  });
  expect(
    await createSeedingActivities(ctx).removeMediaTorrent({
      operationId: f.input.operationId,
      torrentId: torrent.id,
    }),
  ).toEqual({ status: "protected", reason: "source_dependencies_changed" });
  expect(calls).toBe(0);
  expect(
    await f.db.torrent.findUnique({ where: { id: torrent.id } }),
  ).toMatchObject({ state: "seeding" });
});
