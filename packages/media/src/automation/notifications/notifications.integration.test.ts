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
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";

const { database, context, fixture, cipher } = automationTestHarness();
async function setup(kind: "movie" | "episode" = "movie") {
  const data = await fixture("123", { kind });
  const db = database();
  await grantTestLease(db);
  await db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: data.media.id, edition: "default" } },
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
      editionRootId: data.series?.id ?? data.media.id,
      sizeBytes: 10,
      checksum: "a".repeat(64),
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      plexPublishedAt: new Date(),
      properties: { releaseId: data.release.id },
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
    movieAccess: () =>
      Promise.resolve({
        serverMachineId: "fixture-server",
        movieSectionId: "1",
      }),
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

test("a TV acquisition groups new episodes, preserves upgrade opt-in, and never announces skipped coverage", async () => {
  const data = await setup("episode");
  const db = database();
  if (data.series === null)
    throw new Error("TV notification fixture lacks its canonical series");
  const items = [data.item];
  for (let index = 0; index < 3; index++) {
    const media = await db.mediaItem.create({
      data: {
        kind: "episode",
        parentId: data.series.id,
        title: `Episode ${String(index)}`,
        availability: "available",
        intents: { create: { generation: 1, automationEpoch: 0 } },
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

test.each(["movie", "episode"] as const)(
  "known %s rejection requires explicit bounded retry and preserves the original attempt",
  async (kind) => {
    const data = await setup(kind);
    const service =
      kind === "movie"
        ? data.service
        : new PrismaNotificationApplication(database(), cipher, null, {
            publicOrigin: "https://media.fixture",
            movieAccess: () =>
              Promise.reject(
                new Error("TV retry must not resolve movie configuration"),
              ),
          });
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
    const retryKey = crypto.randomUUID();
    let retried;
    try {
      retried = await service.retryDelivery(
        data.user,
        retryKey,
        delivery.id,
        rejected.version,
      );
    } finally {
      time.mockRestore();
    }
    const saved = await database().idempotencyRecord.findUniqueOrThrow({
      where: { userId_key: { userId: data.user.id, key: retryKey } },
    });
    const replay = new PrismaNotificationApplication(database(), cipher, null, {
      publicOrigin: "https://media.fixture",
      movieAccess: () =>
        Promise.reject(
          new Error("Exact retry replay must precede configuration"),
        ),
    });
    expect(
      await replay.retryDelivery(
        data.user,
        retryKey,
        delivery.id,
        rejected.version,
      ),
    ).toEqual(retried);
    expect(
      await database().idempotencyRecord.findUniqueOrThrow({
        where: { userId_key: { userId: data.user.id, key: retryKey } },
      }),
    ).toEqual(saved);
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
  },
);

test("independent movie and TV acquisitions can deliver a mixed readiness batch to the same requester", async () => {
  const movie = await setup();
  const tv = await setup("episode");
  const db = database();
  await db.mediaRequest.create({
    data: { userId: movie.user.id, mediaId: tv.media.id },
  });
  for (const data of [movie, tv]) {
    const claim = await db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: data.user.id,
          mediaId: data.media.id,
          edition: "default",
        },
      },
    });
    const birth =
      data.media.kind === "movie"
        ? await captureMovieAttemptChoice(db, {
            sponsorRequestId: claim.id,
            scope: {
              rootMediaId: data.media.id,
              mediaId: data.media.id,
              edition: "default",
            },
            access: { serverMachineId: "fixture-server", movieSectionId: "1" },
          })
        : {};
    const attempt = await db.acquisitionAttempt.create({
      data: {
        ...birth,
        releaseId: data.release.id,
        sponsorRequestId: claim.id,
        mediaIds: [data.media.id],
        generations: { [data.media.id]: data.item.generation },
        state: "publishing",
        operationId: data.input.operationId,
        recoveryEpoch: 0,
        filePlan: [
          {
            assetId: data.asset.id,
            mediaIds: [data.media.id],
            generations: { [data.media.id]: data.item.generation },
            checksum: data.asset.checksum,
            previousAssetId: null,
          },
        ],
      },
    });
    await db.$transaction((tx) =>
      queuePublicationNotifications(tx, attempt.id),
    );
  }
  const key = `mixed-ready:${crypto.randomUUID()}`;
  await db.$transaction((tx) =>
    queueLifecycleNotifications(tx, {
      key,
      kind: "media_available",
      epoch: 0,
      items: [movie.item, tv.item],
    }),
  );
  const delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { userId: movie.user.id, event: { dedupeKey: { startsWith: key } } },
    include: { event: true },
  });
  expect(delivery.event.payload).toMatchObject({
    items: [movie.item, tv.item].sort((a, b) =>
      a.mediaId.localeCompare(b.mediaId),
    ),
  });
  const messages: string[] = [];
  expect(
    await createNotificationActivities({
      ...context(),
      notify: (message) => {
        messages.push(message.text);
        return Promise.resolve({ receipt: "fixture:mixed" });
      },
    }).deliverMediaNotification({
      operationId: movie.input.operationId,
      notificationId: delivery.id,
    }),
  ).toMatchObject({ status: "accepted" });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("2 requested titles");
});

test("a rejected readiness delivery cannot be retried after actual revocation leaves pending movie demand", async () => {
  const data = await setup();
  const db = database();
  const delivery = await queue(data);
  const activities = createNotificationActivities({
    ...context(),
    notify: () =>
      Promise.reject(new IntegrationError("postal", "authentication")),
  });
  expect(
    await activities.deliverMediaNotification({
      operationId: data.input.operationId,
      notificationId: delivery.id,
    }),
  ).toMatchObject({ status: "failed" });
  const failed = await db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: data.user.id,
        mediaId: data.media.id,
        edition: "default",
      },
    },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: data.media.id, edition: "default" } },
  });
  const app = new PrismaMediaApplication(db, {
    keepDays: 7,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  await app.revokeMovieEditionChoice(data.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "revoke_choice",
    subjectUserId: data.user.id,
    scope: {
      rootMediaId: data.media.id,
      mediaId: data.media.id,
      edition: "default",
    },
    requestId: request.id,
    expected: {
      requestVersion: request.version,
      targetVersion: target.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  const key = crypto.randomUUID();
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  try {
    await expect(
      data.service.retryDelivery(data.user, key, delivery.id, failed.version),
    ).rejects.toMatchObject({ code: "delivery_obsolete" });
  } finally {
    clock.mockRestore();
  }
  expect(
    await db.idempotencyRecord.count({ where: { userId: data.user.id, key } }),
  ).toBe(0);
  expect(
    await db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    }),
  ).toEqual(failed);
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

test.each(["obsolete_version", "unverified_quality"])(
  "cancelled requests and %s subtitles are suppressed before sending",
  async (reason) => {
    const data = await setup();
    const delivery = await queue(data);
    const app = new PrismaMediaApplication(database(), {
      keepDays: 7,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    const request = await database().mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: data.user.id,
          mediaId: data.media.id,
          edition: "default",
        },
      },
    });
    await app.cancelRequest(
      data.user,
      crypto.randomUUID(),
      request.id,
      request.version,
    );
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
    await chooseTestMovieEdition(database(), {
      actor: data.user,
      mediaId: data.media.id,
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
      subtitleLanguages: ["en"],
    });
    const renewed = await database().mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: data.media.id, edition: "default" },
      },
    });
    data.item.generation = renewed.generation;
    const installed = await database().subtitleAsset.create({
      data: {
        assetId: data.asset.id,
        language: "en",
        providerId: "fixture",
        state: "installed",
        qualityStatus: "accepted",
        storageKind: "sidecar",
        ownershipEpoch: 0,
        videoChecksum: data.asset.checksum,
        videoVersion: data.asset.version,
        checksum: "c".repeat(64),
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
    if (reason === "unverified_quality")
      await database().subtitleAsset.update({
        where: { id: installed.id },
        data: { qualityStatus: "unverified" },
      });
    else
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
  },
);

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
      ...(await captureMovieAttemptChoice(db, {
        sponsorRequestId: claim.id,
        scope: {
          rootMediaId: data.media.id,
          mediaId: data.media.id,
          edition: "default",
        },
        access: { serverMachineId: "fixture-server", movieSectionId: "1" },
      })),
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
