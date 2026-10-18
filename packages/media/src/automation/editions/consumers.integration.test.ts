import { afterEach, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { queueLifecycleNotifications } from "#automation/notifications/events.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { readMovieRequestFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { createNotificationTransport } from "#integrations/notification-transport.ts";

const h = automationTestHarness();
const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(verified = true) {
  const db = h.database();
  const f = await fileFixture(db);
  directories.push(f.directory);
  const published = await f.published();
  const retention = verified ? await f.retention() : null;
  if (verified)
    await db.mediaItem.update({
      where: { id: f.media.id },
      data: { availability: "available" },
    });
  await db.mediaUser.update({
    where: { id: f.user.id },
    data: {
      email: "recipient@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: published.entry.assetId },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  const app = new PrismaMediaApplication(db, { keepDays: 7, ...access });
  return {
    ...f,
    published,
    retention,
    createRetention: f.retention,
    asset,
    target,
    app,
  };
}

async function queueReady(f: Awaited<ReturnType<typeof fixture>>) {
  await h.database().$transaction((tx) =>
    queueLifecycleNotifications(tx, {
      key: `choice-ready:${f.media.id}`,
      kind: "media_available",
      epoch: 0,
      items: [
        {
          mediaId: f.media.id,
          generation: f.target.generation,
          assetId: f.asset.id,
          assetVersion: f.asset.version,
          assetChecksum: f.asset.checksum ?? "",
        },
      ],
    }),
  );
  return h.database().notificationDelivery.findFirstOrThrow({
    where: { userId: f.user.id, event: { kind: "media_available" } },
  });
}

test("final Discord channel response expires movie mapping before message POST and records known rejection", async () => {
  const f = await fixture();
  const db = h.database();
  await db.mediaUser.update({
    where: { id: f.user.id },
    data: {
      discordId: "12345",
      notificationPreference: {
        update: { emailEnabled: false, discordEnabled: true },
      },
    },
  });
  const delivery = await queueReady(f);
  expect(delivery.channel).toBe("discord");
  const clock = Date.now();
  await db.plexIdentityMapping.update({
    where: { userId: f.user.id },
    data: { verifiedAt: new Date(clock - 295_000) },
  });
  let reached = false;
  let messages = 0;
  const notify = createNotificationTransport(
    { discord: { botToken: "fixture" } },
    async (url) => {
      if (url.pathname.endsWith("users/@me/channels")) {
        reached = true;
        vi.spyOn(Date, "now").mockReturnValue(clock + 10_000);
        return Response.json({ id: "45678" });
      }
      messages++;
      throw new Error("Unexpected message POST");
    },
  );
  const result = await createNotificationActivities({
    ...h.context(),
    personalDiscordAvailable: () => Promise.resolve(true),
    notify,
  }).deliverMediaNotification({
    operationId: crypto.randomUUID(),
    notificationId: delivery.id,
  });
  expect(reached).toBe(true);
  expect(messages).toBe(0);
  expect(result).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(
    await db.notificationDeliveryAttempt.findFirstOrThrow({
      where: { deliveryId: delivery.id },
    }),
  ).toMatchObject({
    state: "rejected",
    rejectionReason: "authority_changed_before_send",
    providerReceipt: null,
  });
});

test("physical promotion without verified Plex readback neither fulfills nor sends readiness", async () => {
  const f = await fixture(false);
  expect(
    await readMovieRequestFulfillment(h.database(), {
      requestId: f.request.id,
      currentAsset: { assetId: f.asset.id, assetVersion: f.asset.version },
      access,
    }),
  ).toEqual({
    status: "pending_asset",
    reason: "movie_edition_asset_unavailable",
  });
  const delivery = await queueReady(f);
  const result = await createNotificationActivities(
    h.context(),
  ).deliverMediaNotification({
    operationId: crypto.randomUUID(),
    notificationId: delivery.id,
  });
  expect(result.status).toBe("failed");
  expect(
    await h.database().notificationDeliveryAttempt.count({
      where: { deliveryId: delivery.id },
    }),
  ).toBe(0);
});

test("a queued readiness message is rejected when its actual choice is revoked after claim", async () => {
  const f = await fixture();
  expect(
    await readMovieRequestFulfillment(h.database(), {
      requestId: f.request.id,
      currentAsset: { assetId: f.asset.id, assetVersion: f.asset.version },
      access,
    }),
  ).toEqual({ status: "fulfilled", reason: null });
  const delivery = await queueReady(f);
  let reached = false;
  const context = {
    ...h.context(),
    checkpoint: async () => {
      reached = true;
      const request = await h
        .database()
        .mediaRequest.findUniqueOrThrow({ where: { id: f.request.id } });
      await f.app.revokeMovieEditionChoice(
        { ...f.user, role: "member" },
        crypto.randomUUID(),
        {
          schemaVersion: 3,
          action: "revoke_choice",
          subjectUserId: f.user.id,
          scope: {
            rootMediaId: f.media.id,
            mediaId: f.media.id,
            edition: "default",
          },
          requestId: request.id,
          expected: {
            targetVersion: f.target.version,
            requestVersion: request.version,
            choiceRevision: request.movieEditionChoiceRevision,
          },
        },
      );
    },
  };
  expect(
    await createNotificationActivities(context).deliverMediaNotification({
      operationId: crypto.randomUUID(),
      notificationId: delivery.id,
    }),
  ).toEqual({ status: "failed", reason: "authority_changed_before_send" });
  expect(reached).toBe(true);
  expect(
    await h.database().notificationDeliveryAttempt.findFirstOrThrow({
      where: { deliveryId: delivery.id },
    }),
  ).toMatchObject({ state: "rejected", providerReceipt: null });
});

test.each(["owner_missing", "member_named"])(
  "%s demand protects automatic retention and actual final quarantine",
  async (kind) => {
    const f = await fixture();
    const db = h.database();
    const user = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Pending viewer",
        role: kind === "owner_missing" ? "owner" : "member",
      },
    });
    await grantTestRequesterAccess(db, user.id, access.serverMachineId);
    const actor = {
      ...user,
      role: kind === "owner_missing" ? ("owner" as const) : ("member" as const),
    };
    if (kind === "owner_missing")
      await f.app.createRequest(actor, crypto.randomUUID(), {
        mediaId: f.media.id,
        subtitleLanguages: [],
        includeSpecials: false,
      });
    else
      await chooseTestMovieEdition(db, {
        actor,
        mediaId: f.media.id,
        edition: "extended_cut",
        access,
      });
    // Build a separate current-generation grace fixture, preserving the cancelled older decision.
    // This exercises the final request guard independently of command-side invalidation.
    const currentRetention = await f.createRetention();
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    if (f.retention === null)
      throw new Error("Verified retention fixture missing");
    const expected =
      kind === "owner_missing"
        ? "movie_edition_choice_required"
        : "edition_acquisition_not_ready";
    expect(
      await createRetentionActivities(h.context()).evaluateMediaRetention({
        mediaId: f.media.id,
        generation: target.generation,
        operationId: crypto.randomUUID(),
      }),
    ).toMatchObject({ status: "protected", reason: expected });
    expect(
      await createMediaFileActivities(f.context).quarantineMediaFiles(
        currentRetention.input,
      ),
    ).toMatchObject({ status: "protected", reason: expected });
    expect(
      await readFile(
        path.join(f.roots.library, f.published.entry.libraryPath),
        "utf8",
      ),
    ).toBe(f.published.content);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "published", version: f.asset.version });
  },
);

test("shared playable bytes do not turn another subject's pending choice into fulfillment or reveal the chosen request", async () => {
  const f = await fixture();
  const db = h.database();
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Pending owner",
      role: "owner",
    },
  });
  await grantTestRequesterAccess(db, owner.id, access.serverMachineId);
  const actor = { ...owner, role: "owner" as const };
  const requested = await f.app.createRequest(actor, crypto.randomUUID(), {
    mediaId: f.media.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { availability: "available" },
  });
  if (f.asset.torrentId === null)
    throw new Error("Published fixture torrent missing");
  const torrent = await db.torrent.findUniqueOrThrow({
    where: { id: f.asset.torrentId },
  });
  const observation = StoredTorrentObservationSchema.parse({
    hash: torrent.infoHash,
    infohash_v1: torrent.infoHash,
    infohash_v2: "",
    name: "Synthetic published fixture",
    state: "uploading",
    category: "media",
    tags: "fixture",
    save_path: f.roots.downloads,
    content_path: path.join(f.roots.downloads, f.published.entry.downloadPath),
    progress: 1,
    ratio: { kind: "finite", value: 0 },
    seeding_time: 0,
    size: Number(f.asset.sizeBytes),
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
  await db.torrent.update({
    where: { id: torrent.id },
    data: {
      observation: { torrent: observation, files: [] },
      observedAt: new Date(),
    },
  });
  const detail = await f.app.getMedia(actor, f.media.id);
  expect(detail.visibility.playback.playable).toBe(true);
  expect(detail.visibility.movieRequests).toEqual([
    {
      requestId: requested.requestId,
      edition: "default",
      fulfillment: {
        status: "pending_choice",
        reason: "movie_edition_choice_required",
      },
    },
  ]);
  expect(JSON.stringify(detail.visibility.movieRequests)).not.toContain(
    f.request.id,
  );
  expect(JSON.stringify(detail.visibility.movieRequests)).not.toContain(
    f.user.id,
  );
});
