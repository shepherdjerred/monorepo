import { expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestLease } from "#testing/authority.ts";
import {
  queueLifecycleNotifications,
  queuePublicationNotifications,
} from "./events.ts";
import { queueSharedPublication } from "./shared.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { IntegrationError } from "#integrations/http.ts";
import { reconcileDelivery } from "./reconcile.ts";
import { deliveryInclude } from "./message.ts";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

const { database, context, fixture, cipher } = automationTestHarness();
async function setup() {
  const data = await fixture();
  const db = database();
  await grantTestLease(db);
  await db.mediaIntent.update({
    where: { mediaId: data.media.id },
    data: { automationEpoch: 0 },
  });
  await db.mediaItem.update({
    where: { id: data.media.id },
    data: { availability: "available" },
  });
  const user = await db.mediaUser.update({
    where: { id: data.user.id },
    data: {
      email: "fixture@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const asset = await db.libraryAsset.create({
    data: {
      path: `/library/${data.media.id}.mkv`,
      sizeBytes: 10,
      checksum: "a".repeat(64),
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      plexPublishedAt: new Date(),
      properties: {},
      coverage: { create: { mediaId: data.media.id, current: true } },
    },
  });
  const item = {
    mediaId: data.media.id,
    generation: 1,
    assetId: asset.id,
    assetVersion: 0,
    assetChecksum: asset.checksum ?? "",
  };
  const service = new PrismaNotificationApplication(db, cipher, null, {
    publicOrigin: "https://media.fixture",
  });
  return { ...data, user, asset, item, service };
}
async function queue(
  data: Awaited<ReturnType<typeof setup>>,
  kind: "media_available" | "subtitles_ready" = "media_available",
) {
  await database().$transaction((tx) =>
    queueLifecycleNotifications(tx, {
      key: `fixture:${data.media.id}:${kind}`,
      kind,
      epoch: 0,
      items: [data.item],
    }),
  );
  return await database().notificationDelivery.findFirstOrThrow({
    where: { userId: data.user.id },
    orderBy: { createdAt: "desc" },
  });
}

test("a mixed acquisition groups new episodes, preserves upgrade opt-in, and never announces skipped coverage", async () => {
  const data = await setup();
  const db = database();
  const items = [data.item];
  for (let index = 0; index < 3; index++) {
    const media = await db.mediaItem.create({
      data: {
        kind: "episode",
        title: `Episode ${String(index)}`,
        availability: "available",
        intent: { create: { generation: 1, automationEpoch: 0 } },
        requests: { create: { userId: data.user.id } },
      },
    });
    const asset = await db.libraryAsset.create({
      data: {
        path: `/library/${media.id}.mkv`,
        sizeBytes: 10,
        checksum: "a".repeat(64),
        owned: true,
        ownershipEpoch: 0,
        state: "published",
        plexPublishedAt: new Date(),
        properties: {},
        coverage: { create: { mediaId: media.id, current: true } },
      },
    });
    items.push({
      mediaId: media.id,
      generation: 1,
      assetId: asset.id,
      assetVersion: 0,
      assetChecksum: "a".repeat(64),
    });
  }
  const upgraded = items[2];
  if (upgraded === undefined) throw new Error("Missing upgraded fixture");
  const previous = await db.libraryAsset.create({
    data: {
      path: `/rollback/${upgraded.mediaId}`,
      sizeBytes: 5,
      checksum: "b".repeat(64),
      owned: true,
      state: "superseded",
      plexPublishedAt: new Date(),
      supersededByAssetId: upgraded.assetId,
      properties: {},
      coverage: { create: { mediaId: upgraded.mediaId, current: false } },
    },
  });
  const claim = await db.mediaRequest.findFirstOrThrow({
    where: { mediaId: data.media.id },
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      releaseId: data.release.id,
      sponsorRequestId: claim.id,
      mediaIds: items.map((item) => item.mediaId),
      generations: Object.fromEntries(
        items.map((item) => [item.mediaId, item.generation]),
      ),
      state: "publishing",
      operationId: data.input.operationId,
      recoveryEpoch: 0,
      filePlan: items.slice(0, 3).map((item) => ({
        assetId: item.assetId,
        mediaIds: [item.mediaId],
        generations: { [item.mediaId]: 1 },
        checksum: item.assetChecksum,
        previousAssetId: item.mediaId === upgraded.mediaId ? previous.id : null,
      })),
    },
  });
  for (let replay = 0; replay < 2; replay++)
    await db.$transaction((tx) =>
      queuePublicationNotifications(tx, attempt.id),
    );
  const deliveries = await db.notificationDelivery.findMany({
    where: { userId: data.user.id },
    include: { event: true },
  });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.event.payload).toMatchObject({
    items: [items[0], items[1]].sort((a, b) =>
      (a?.mediaId ?? "").localeCompare(b?.mediaId ?? ""),
    ),
  });
  expect(
    await db.applicationEvent.count({
      where: {
        dedupeKey: {
          startsWith: `publication:${attempt.id}:media_upgraded:item:`,
        },
      },
    }),
  ).toBe(1);
  expect(
    await db.applicationEvent.count({
      where: {
        mediaId: items[3]?.mediaId ?? "missing-fixture",
        kind: { in: ["media_available", "media_upgraded"] },
      },
    }),
  ).toBe(0);
  await db.notificationPreference.update({
    where: { userId: data.user.id },
    data: { upgrades: true },
  });
  await db.$transaction((tx) => queuePublicationNotifications(tx, attempt.id));
  expect(
    await db.notificationDelivery.count({ where: { userId: data.user.id } }),
  ).toBe(2);
});

test("known rejection requires explicit bounded retry and preserves the original attempt", async () => {
  const data = await setup();
  const delivery = await queue(data);
  let sends = 0;
  const runtime = {
    ...context(),
    notify: async () => {
      sends++;
      if (sends === 1) throw new IntegrationError("postal", "authentication");
      return { receipt: "fixture:42" };
    },
  };
  const activities = createNotificationActivities(runtime);
  const input = {
    operationId: data.input.operationId,
    notificationId: delivery.id,
  };
  expect(await activities.deliverMediaNotification(input)).toMatchObject({
    status: "failed",
  });
  expect(await activities.deliverMediaNotification(input)).toMatchObject({
    status: "failed",
  });
  expect(sends).toBe(1);
  const rejected = await database().notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  try {
    await data.service.retryDelivery(
      data.user,
      crypto.randomUUID(),
      delivery.id,
      rejected.version,
    );
  } finally {
    time.mockRestore();
  }
  expect(await activities.deliverMediaNotification(input)).toMatchObject({
    status: "accepted",
  });
  expect(sends).toBe(2);
  expect(
    await database().notificationDeliveryAttempt.findMany({
      where: { deliveryId: delivery.id },
      orderBy: { attemptNumber: "asc" },
      select: { state: true, recoveryEpoch: true },
    }),
  ).toEqual([
    { state: "rejected", recoveryEpoch: 0 },
    { state: "accepted", recoveryEpoch: 0 },
  ]);
});

test("unknown sends never retry; exact receipt reconciliation cannot cross a restore epoch", async () => {
  const data = await setup();
  const delivery = await queue(data);
  let sends = 0;
  const runtime = {
    ...context(),
    notify: async () => {
      sends++;
      throw new IntegrationError("postal", "outcome-unknown");
    },
    reconcileNotification: async () => ({
      status: "accepted" as const,
      recipient: "fixture@example.com",
    }),
  };
  const activity = createNotificationActivities(runtime);
  const input = {
    operationId: data.input.operationId,
    notificationId: delivery.id,
  };
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    status: "unknown",
  });
  const unknown = await database().notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  await expect(
    data.service.retryDelivery(
      data.user,
      crypto.randomUUID(),
      delivery.id,
      unknown.version,
    ),
  ).rejects.toMatchObject({ code: "delivery_conflict" });
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    status: "unknown",
  });
  expect(sends).toBe(1);
  const attempt = await database().notificationDeliveryAttempt.findFirstOrThrow(
    {
      where: { deliveryId: delivery.id },
    },
  );
  await database().notificationDeliveryAttempt.update({
    where: { id: attempt.id },
    data: { providerReceipt: "42" },
  });
  await database().mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await grantTestLease(database(), 1);
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    reason: "notification_runtime_protected",
  });
  expect(sends).toBe(1);
  const preserved =
    await database().notificationDeliveryAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
  expect(preserved.recoveryEpoch).toBe(0);
});

test("cancelled requests and obsolete subtitle versions are suppressed before sending", async () => {
  const data = await setup();
  const delivery = await queue(data);
  await database().mediaRequest.updateMany({
    where: { userId: data.user.id },
    data: { active: false },
  });
  const activity = createNotificationActivities({
    ...context(),
    notify: async () => {
      throw new Error("Must not send");
    },
  });
  expect(
    await activity.deliverMediaNotification({
      operationId: data.input.operationId,
      notificationId: delivery.id,
    }),
  ).toMatchObject({ status: "failed" });
  await database().mediaRequest.updateMany({
    where: { userId: data.user.id },
    data: { active: true },
  });
  await database().mediaRequest.updateMany({
    where: { mediaId: data.media.id },
    data: { subtitleLanguages: ["en"] },
  });
  const installed = await database().subtitleAsset.create({
    data: {
      assetId: data.asset.id,
      language: "en",
      providerId: "fixture",
      state: "installed",
      provenance: {},
      matchingEvidence: {},
    },
  });
  await database().$transaction((tx) =>
    queueLifecycleNotifications(tx, {
      key: `subtitle:${installed.id}`,
      kind: "subtitles_ready",
      epoch: 0,
      items: [{ ...data.item, subtitleId: installed.id, language: "en" }],
    }),
  );
  const subtitle = await database().notificationDelivery.findFirstOrThrow({
    where: { userId: data.user.id, event: { kind: "subtitles_ready" } },
  });
  await database().libraryAsset.update({
    where: { id: data.asset.id },
    data: { version: { increment: 1 } },
  });
  expect(
    await activity.deliverMediaNotification({
      operationId: data.input.operationId,
      notificationId: subtitle.id,
    }),
  ).toMatchObject({ status: "failed" });
});

test("shared announcements never use personal content or preferences", async () => {
  const data = await setup();
  const db = database();
  await db.mediaUser.update({
    where: { id: data.user.id },
    data: { role: "owner" },
  });
  await db.notificationPreference.update({
    where: { userId: data.user.id },
    data: { emailEnabled: false },
  });
  const claim = await db.mediaRequest.findFirstOrThrow({
    where: { mediaId: data.media.id },
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      releaseId: data.release.id,
      sponsorRequestId: claim.id,
      mediaIds: [data.media.id],
      generations: { [data.media.id]: 1 },
      state: "publishing",
      operationId: data.input.operationId,
      recoveryEpoch: 0,
      filePlan: [
        {
          assetId: data.asset.id,
          mediaIds: [data.media.id],
          checksum: data.asset.checksum,
          generations: { [data.media.id]: 1 },
          previousAssetId: null,
        },
      ],
    },
  });
  const settings = {
    enabled: true,
    upgrades: false,
    available: true,
    channelId: "123",
  };
  await db.$transaction(async (tx) => {
    await queuePublicationNotifications(tx, attempt.id);
    for (const unavailable of [
      { ...settings, available: false },
      { ...settings, enabled: false },
      { ...settings, channelId: "" },
    ]) {
      await queueSharedPublication(tx, attempt.id, unavailable);
    }
    expect(
      await tx.notificationDelivery.count({
        where: { userId: data.user.id, channel: "discord_shared" },
      }),
    ).toBe(0);
    await queueSharedPublication(tx, attempt.id, settings);
  });
  const delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { userId: data.user.id, channel: "discord_shared" },
  });
  let text = "";
  await createNotificationActivities({
    ...context(),
    sharedAnnouncements: async () => settings,
    notify: async (message) => {
      text = message.text;
      expect(message.recipient).toBe("123");
      return { receipt: "discord:123:456" };
    },
  }).deliverMediaNotification({
    notificationId: delivery.id,
    operationId: data.input.operationId,
  });
  expect(text).toContain("Example");
  expect(text).not.toContain(data.user.id);
  expect(text).not.toMatch(/fixture@example|watched|retention|requester/iu);
});

test("final send holds media, effective claim, and preference authority until the provider resolves", async () => {
  const data = await setup();
  const delivery = await queue(data);
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const sending = createNotificationActivities({
    ...context(),
    notify: async () => {
      entered.resolve();
      await release.promise;
      return { receipt: "fixture" };
    },
  }).deliverMediaNotification({
    operationId: data.input.operationId,
    notificationId: delivery.id,
  });
  await entered.promise;
  try {
    for (const target of ["media", "claim", "preference"]) {
      await expect(
        database().$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
          if (target === "media")
            await tx.mediaItem.update({
              where: { id: data.media.id },
              data: { version: { increment: 1 } },
            });
          if (target === "claim")
            await tx.mediaRequest.updateMany({
              where: { mediaId: data.media.id },
              data: { active: false },
            });
          if (target === "preference")
            await tx.notificationPreference.update({
              where: { userId: data.user.id },
              data: { emailEnabled: false },
            });
        }),
      ).rejects.toThrow(/lock timeout/u);
    }
  } finally {
    release.resolve();
  }
  expect(await sending).toMatchObject({ status: "accepted" });
});

test.each(["pending", "sending"] as const)(
  "old receipt cannot overwrite a retry that is %s",
  async (state) => {
    const data = await setup();
    const delivery = await queue(data);
    await createNotificationActivities({
      ...context(),
      notify: async () => ({ receipt: "old-receipt" }),
    }).deliverMediaNotification({
      operationId: data.input.operationId,
      notificationId: delivery.id,
    });
    const snapshot = await database().notificationDelivery.update({
      where: { id: delivery.id },
      data: { providerStatus: "bounced" },
      include: deliveryInclude,
    });
    let reconciliation: Promise<unknown> | undefined;
    let blocked = false;
    let reads = 0;
    await database().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${data.media.id} FOR UPDATE`;
      reconciliation = (async () => {
        try {
          return await reconcileDelivery(
            {
              ...context(),
              reconcileNotification: async () => {
                reads++;
                return { status: "delivered", recipient: data.user.email };
              },
            },
            snapshot,
            true,
          );
        } catch (error) {
          return { error };
        }
      })();
      for (let poll = 0; poll < 100; poll++) {
        await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
        const rows = z
          .array(z.object({ count: z.bigint() }))
          .parse(
            await tx.$queryRaw`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%MediaItem%'`,
          );
        if ((rows[0]?.count ?? 0n) > 0n) {
          blocked = true;
          break;
        }
        await setTimeout(10);
      }
      await tx.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          state,
          acceptedAt: null,
          providerReceipt: null,
          providerStatus: null,
          version: { increment: 1 },
          attempts: state === "sending" ? 2 : 1,
        },
      });
      if (state === "sending")
        await tx.notificationDeliveryAttempt.create({
          data: {
            deliveryId: delivery.id,
            attemptNumber: 2,
            recoveryEpoch: 0,
            state: "sending",
            recipientFingerprint: "fixture-new-attempt",
            startedAt: new Date(),
          },
        });
    });
    expect(await reconciliation).toMatchObject({
      status: "unknown",
      reason: "receipt_authority_changed",
    });
    expect(blocked).toBe(true);
    expect(reads).toBe(0);
    const current = await database().notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(current).toMatchObject({
      state,
      acceptedAt: null,
      providerReceipt: null,
    });
  },
);
