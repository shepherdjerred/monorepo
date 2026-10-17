import type { Database } from "#infrastructure/database.ts";
import { z } from "zod";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";

export async function visibilityFixture(db: Database) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Household owner",
      role: "owner",
    },
  });
  const member = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Member",
      role: "member",
    },
  });
  for (const user of [owner, member])
    await grantTestRequesterAccess(db, user.id, "visibility-fixture");
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Visibility movie",
      externalIds: { plexSectionId: "1" },
      availability: "downloading",
      intents: { create: { availability: "downloading" } },
    },
  });
  const request = await db.mediaRequest.create({
    data: { mediaId: media.id, userId: member.id },
  });
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "knaben",
      providerReleaseId: crypto.randomUUID(),
      title: "SECRET release path",
      attributes: {},
      evaluation: {},
      mediaIds: [media.id],
    },
  });
  const operation = await db.operation.create({
    data: {
      userId: member.id,
      idempotencyKey: crypto.randomUUID(),
      kind: "reconcile_media",
      targetId: media.id,
      payload: {},
    },
  });
  const observation = {
    torrent: {
      hash: "a".repeat(40),
      infohash_v1: "a".repeat(40),
      infohash_v2: "",
      name: "PRIVATE raw name",
      state: "downloading",
      category: "media",
      tags: "PRIVATE tags",
      progress: 0.4,
      ratio: { kind: "finite", value: 0.2 },
      seeding_time: 0,
      size: 1000,
      save_path: "/PRIVATE/download",
      content_path: "/PRIVATE/file.mkv",
      ratio_limit: -1,
      seeding_time_limit: -1,
      inactive_seeding_time_limit: -1,
      max_ratio: -1,
      max_seeding_time: -1,
      max_inactive_seeding_time: -1,
      share_limit_action: "Stop",
      auto_tmm: false,
      force_start: false,
    },
    files: [],
  };
  const torrent = await db.torrent.create({
    data: {
      infoHash: crypto.randomUUID().replaceAll("-", "").padEnd(40, "a"),
      providerId: "knaben",
      owned: true,
      ownershipEpoch: runtime.recoveryEpoch,
      seedingPolicy: { kind: "public" },
      state: "downloading",
      observation,
      observedAt: new Date(),
    },
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      operationId: operation.id,
      releaseId: release.id,
      sponsorRequestId: request.id,
      mediaIds: [media.id],
      generations: { [media.id]: 0 },
      state: "downloading",
      torrentId: torrent.id,
      recoveryEpoch: runtime.recoveryEpoch,
    },
  });
  const app = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "visibility-fixture",
  });
  async function publish() {
    const current = await db.mediaItem.findUniqueOrThrow({
      where: { id: media.id },
    });
    await db.mediaItem.update({
      where: { id: media.id },
      data: {
        availability: "available",
        externalIds: {
          ...z.record(z.string(), z.json()).parse(current.externalIds),
          plexRatingKey: "fixture-rating",
        },
      },
    });
    return db.libraryAsset.create({
      data: {
        path: `/PRIVATE/${crypto.randomUUID()}.mkv`,
        checksum: "b".repeat(64),
        sizeBytes: 1000,
        owned: true,
        ownershipEpoch: runtime.recoveryEpoch,
        state: "published",
        plexPublishedAt: new Date(),
        version: 3,
        properties: {
          quality: "WEB-1080p",
          path: "SECRET",
          releaseTitle: "SECRET",
        },
        torrentId: torrent.id,
        coverage: {
          create: { mediaId: media.id, current: true },
        },
      },
    });
  }
  return {
    db,
    owner,
    member,
    media,
    request,
    release,
    operation,
    attempt,
    torrent,
    observation,
    app,
    publish,
    runtime,
  };
}
