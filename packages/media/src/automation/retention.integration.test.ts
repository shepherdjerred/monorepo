import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { randomBytes } from "node:crypto";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { PlexClient } from "#integrations/plex.ts";
import { TmdbClient } from "#integrations/tmdb.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { DatabaseProviderRegistry } from "./providers.ts";
import type { MediaAutomationContext } from "./context.ts";
import { createRetentionActivities } from "./retention.ts";
import { createNotificationActivities } from "./notifications.ts";
import { createSubtitleActivities } from "./subtitles.ts";
import { grantTestLease } from "#testing/authority.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

test("observe mode and a changed recovery epoch cannot send restored pending notifications", async () => {
  const item = await fixture();
  await createRetentionActivities(item.context).evaluateMediaRetention(
    item.input,
  );
  const delivery = await cluster.database.notificationDelivery.findFirstOrThrow(
    { where: { userId: item.user.id } },
  );
  const input = {
    operationId: item.input.operationId,
    notificationId: delivery.id,
  };
  const notifications = createNotificationActivities(item.context);
  try {
    await cluster.database.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "observe" },
    });
    await expect(
      notifications.deliverMediaNotification(input),
    ).resolves.toMatchObject({
      status: "failed",
      reason: "notification_runtime_protected",
    });
    await cluster.database.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", recoveryEpoch: delivery.recoveryEpoch + 1 },
    });
    await expect(
      notifications.deliverMediaNotification(input),
    ).resolves.toMatchObject({
      status: "failed",
      reason: "notification_runtime_protected",
    });
    expect(item.observation.sends).toBe(0);
    expect(
      await cluster.database.notificationDelivery.findUnique({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ state: "pending" });
  } finally {
    await cluster.database.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", recoveryEpoch: delivery.recoveryEpoch },
    });
  }
});

async function fixture() {
  const db = cluster.database;
  await grantTestLease(db);
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Requester",
      email: "fixture@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Fixture",
      availability: "available",
      externalIds: { plexRatingKey: "42" },
      intent: { create: { automationEpoch: 0 } },
      requests: { create: { userId: user.id } },
    },
  });
  const asset = await db.libraryAsset.create({
    data: {
      path: `/data/movies/${media.id}.mkv`,
      sizeBytes: 1024,
      checksum: "a".repeat(64),
      owned: true,
      ownershipEpoch: 0,
      properties: {},
      state: "published",
      coverage: { create: { mediaId: media.id, current: true } },
    },
  });
  await db.credential.create({
    data: {
      userId: user.id,
      kind: "plex",
      ciphertext: cipher.encrypt(
        JSON.stringify({ serverToken: "fixture" }),
        `plex:${user.plexAccountId}`,
      ),
    },
  });
  const observation = {
    watched: true,
    playing: false,
    sends: 0,
    loseResponse: false,
    bounced: false,
  };
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "test",
    },
    async (url) => {
      const item = {
        ratingKey: "42",
        type: "movie",
        title: "Fixture",
        viewCount: observation.watched ? 1 : 0,
      };
      if (url.pathname.endsWith("sessions"))
        return Response.json({
          MediaContainer: {
            size: observation.playing ? 1 : 0,
            Metadata: observation.playing ? [item] : [],
          },
        });
      return Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
    },
  );
  const context: MediaAutomationContext = {
    db,
    tmdb: new TmdbClient({ kind: "bearer", token: "fixture" }),
    describeWorkflow: async () => null,
    permittedSections: async () => ({ movie: "1", series: "2" }),
    refreshExclusionProofs: () => Promise.resolve(),
    refreshWriterLease: () => Promise.resolve(),
    cipher,
    plex,
    userPlex: () => plex,
    downloadRoot: "/downloads",
    qbittorrent: new QbittorrentClient({
      baseUrl: "http://qbit.fixture",
      username: "fixture",
      password: "fixture",
      category: "media",
    }),
    providers: new DatabaseProviderRegistry(db, cipher),
    startWorkflow: async () => {
      throw new Error("Fixture must not dispatch workflows");
    },
    gates: {
      acquisition: async () => true,
      sourceCleanup: async () => true,
      quarantine: async () => true,
      purge: async () => true,
    },
    publicOrigin: "https://media.example.com",
    reconcileNotification: async () => ({
      status: observation.bounced ? "bounced" : "delivered",
      recipient: user.email,
    }),
    notify: async () => {
      observation.sends++;
      if (observation.loseResponse) throw new Error("lost response");
      return { receipt: "fixture-receipt" };
    },
  };
  return {
    context,
    media,
    user,
    asset,
    observation,
    input: {
      operationId: crypto.randomUUID(),
      mediaId: media.id,
      generation: 0,
    },
  };
}

test("requires accepted warning and seven full days, then a fresh playback/hold check", async () => {
  const item = await fixture();
  const retention = createRetentionActivities(item.context);
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ status: "warning" });
  const delivery = await cluster.database.notificationDelivery.findFirstOrThrow(
    {
      where: { userId: item.user.id },
    },
  );
  await expect(
    createNotificationActivities(item.context).deliverMediaNotification({
      operationId: "notification",
      notificationId: delivery.id,
    }),
  ).resolves.toMatchObject({ status: "accepted" });
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ status: "grace" });
  await cluster.database.notificationDelivery.update({
    where: { id: delivery.id },
    data: { acceptedAt: new Date(Date.now() - 8 * 86_400_000) },
  });
  const eligible = await retention.evaluateMediaRetention(item.input);
  expect(eligible.status).toBe("quarantine");
  const decision = await cluster.database.retentionDecision.findUniqueOrThrow({
    where: { id: eligible.decisionId ?? "missing" },
  });
  expect(decision.evidence).toMatchObject({
    activePlayback: false,
    recoveryEpoch: 0,
    warningEventId: delivery.eventId,
  });
  item.observation.playing = true;
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ reason: "active_playback" });
  item.observation.playing = false;
  await cluster.database.retentionHold.create({
    data: { userId: item.user.id, mediaId: item.media.id, isPin: true },
  });
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ reason: "keep_hold" });
});

test("unknown delivery is not retried or counted as acceptance", async () => {
  const item = await fixture();
  const retention = createRetentionActivities(item.context);
  await retention.evaluateMediaRetention(item.input);
  const delivery = await cluster.database.notificationDelivery.findFirstOrThrow(
    {
      where: { userId: item.user.id },
    },
  );
  const notifications = createNotificationActivities(item.context);
  item.observation.loseResponse = true;
  const input = { operationId: "notification", notificationId: delivery.id };
  await expect(
    notifications.deliverMediaNotification(input),
  ).resolves.toMatchObject({ status: "unknown" });
  await expect(
    notifications.deliverMediaNotification(input),
  ).resolves.toMatchObject({ status: "unknown" });
  expect(item.observation.sends).toBe(1);
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ status: "warning" });
  expect(
    await cluster.database.notificationDelivery.findUnique({
      where: { id: delivery.id },
    }),
  ).toMatchObject({ acceptedAt: null });
});

test("a late bounce revokes grace and explicit retry starts seven fresh days", async () => {
  const item = await fixture();
  const retention = createRetentionActivities(item.context);
  const notifications = createNotificationActivities(item.context);
  await retention.evaluateMediaRetention(item.input);
  const delivery = await cluster.database.notificationDelivery.findFirstOrThrow(
    { where: { userId: item.user.id } },
  );
  const input = { operationId: "notification", notificationId: delivery.id };
  await notifications.deliverMediaNotification(input);
  await retention.evaluateMediaRetention(item.input);
  await cluster.database.notificationDelivery.update({
    where: { id: delivery.id },
    data: { acceptedAt: new Date(Date.now() - 8 * 86_400_000) },
  });
  item.observation.bounced = true;
  expect(await retention.evaluateMediaRetention(item.input)).toMatchObject({
    status: "warning",
  });
  const bounced = await cluster.database.notificationDelivery.findUniqueOrThrow(
    { where: { id: delivery.id } },
  );
  expect(bounced.providerStatus).toBe("bounced");
  expect(item.observation.sends).toBe(1);
  const service = new PrismaNotificationApplication(
    cluster.database,
    cipher,
    null,
    { publicOrigin: item.context.publicOrigin },
  );
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
  try {
    await service.retryDelivery(
      { ...item.user, role: "member" },
      crypto.randomUUID(),
      delivery.id,
      bounced.version,
    );
  } finally {
    clock.mockRestore();
  }
  item.observation.bounced = false;
  await notifications.deliverMediaNotification(input);
  expect(await retention.evaluateMediaRetention(item.input)).toMatchObject({
    status: "grace",
  });
  const retried = await cluster.database.notificationDelivery.findUniqueOrThrow(
    { where: { id: delivery.id }, include: { deliveryAttempts: true } },
  );
  expect(retried.acceptedAt?.getTime()).toBeGreaterThanOrEqual(now);
  expect(retried.deliveryAttempts).toHaveLength(2);
  expect(
    retried.deliveryAttempts.every(
      (attempt) => attempt.providerReceipt !== null,
    ),
  ).toBe(true);
});

test.each(["keep", "unknown_watch", "unwatched", "preferences"] as const)(
  "warning final boundary protects %s changes",
  async (change) => {
    const item = await fixture();
    await createRetentionActivities(item.context).evaluateMediaRetention(
      item.input,
    );
    const db = cluster.database;
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { userId: item.user.id },
    });
    if (change === "keep")
      await db.retentionHold.create({
        data: { userId: item.user.id, mediaId: item.media.id, isPin: true },
      });
    if (change === "unknown_watch")
      await db.watchState.deleteMany({ where: { mediaId: item.media.id } });
    if (change === "unwatched")
      await db.watchState.updateMany({
        where: { mediaId: item.media.id },
        data: { watched: false },
      });
    if (change === "preferences")
      await db.notificationPreference.update({
        where: { userId: item.user.id },
        data: { emailEnabled: false },
      });
    expect(
      await createNotificationActivities(item.context).deliverMediaNotification(
        { operationId: "notification", notificationId: delivery.id },
      ),
    ).toMatchObject({ status: "failed" });
    expect(item.observation.sends).toBe(0);
  },
);

test("a shared physical file stays protected for another unwatched requester", async () => {
  const item = await fixture();
  const other = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      title: "Other",
      availability: "available",
      externalIds: { plexRatingKey: "43" },
      intent: { create: { automationEpoch: 0 } },
      requests: { create: { userId: item.user.id } },
      assets: { create: { assetId: item.asset.id, current: true } },
    },
  });
  item.context.userPlex = () =>
    new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token: "fixture",
        clientIdentifier: "test",
      },
      async (url) => {
        const id = url.pathname.split("/").at(-1);
        return Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [
              {
                ratingKey: id,
                type: "movie",
                title: "Fixture",
                viewCount: id === "42" ? 1 : 0,
              },
            ],
          },
        });
      },
    );
  await expect(
    createRetentionActivities(item.context).evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ reason: "requester_unwatched" });
  expect(
    await cluster.database.retentionDecision.count({
      where: { mediaId: other.id },
    }),
  ).toBe(0);
});

test("missing requester credentials removes stale watched evidence", async () => {
  const item = await fixture();
  await cluster.database.watchState.create({
    data: {
      userId: item.user.id,
      mediaId: item.media.id,
      watched: true,
      source: "plex_current",
      observedAt: new Date(),
    },
  });
  await cluster.database.credential.deleteMany({
    where: { userId: item.user.id },
  });
  await expect(
    createRetentionActivities(item.context).evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ reason: "requester_watch_unknown" });
  expect(
    await cluster.database.watchState.count({
      where: { mediaId: item.media.id },
    }),
  ).toBe(0);
});

test("a Plex 404 after quarantine requires visible reconciliation and never means watched", async () => {
  const item = await fixture();
  await cluster.database.mediaItem.update({
    where: { id: item.media.id },
    data: { availability: "quarantined" },
  });
  item.context.userPlex = () =>
    new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token: "fixture",
        clientIdentifier: "test",
      },
      async () => new Response(null, { status: 404 }),
    );
  await expect(
    createRetentionActivities(item.context).evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({
    status: "protected",
    reason: "quarantine_watch_reconciliation_required",
  });
});

test("owner confirmation authorizes recoverable removal and rejects subsequent asset drift", async () => {
  const item = await fixture();
  await cluster.database.mediaUser.update({
    where: { id: item.user.id },
    data: { role: "owner" },
  });
  await cluster.database.mediaIntent.update({
    where: { mediaId: item.media.id },
    data: { desiredPresence: false },
  });
  const ownerOverride = {
    ownerId: item.user.id,
    media: [
      {
        id: item.media.id,
        title: item.media.title,
        version: item.media.version,
        generation: 0,
      },
    ],
    assets: [
      {
        id: item.asset.id,
        version: item.asset.version,
        checksum: item.asset.checksum,
      },
    ],
  };
  await cluster.database.operation.create({
    data: {
      id: item.input.operationId,
      userId: item.user.id,
      kind: "retain_media",
      payload: { ...item.input, action: "remove", ownerOverride },
    },
  });
  const retention = createRetentionActivities(item.context);
  const result = await retention.evaluateMediaRetention(item.input);
  expect(result).toMatchObject({
    status: "quarantine",
    reason: "owner_confirmed_removal",
  });
  const decisionId = result.decisionId ?? "missing";
  await cluster.database.mediaItem.update({
    where: { id: item.media.id },
    data: { availability: "quarantined", version: { increment: 1 } },
  });
  await cluster.database.libraryAsset.update({
    where: { id: item.asset.id },
    data: { state: "quarantined", version: { increment: 1 } },
  });
  await cluster.database.retentionDecision.update({
    where: { id: decisionId },
    data: {
      state: "quarantined",
      quarantinedAt: new Date(),
      purgeAfter: new Date(),
      manifest: {},
    },
  });
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ status: "grace" });
  await cluster.database.retentionDecision.update({
    where: { id: decisionId },
    data: { quarantinedAt: new Date(Date.now() - 8 * 86_400_000) },
  });
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ status: "purge" });
  await cluster.database.libraryAsset.update({
    where: { id: item.asset.id },
    data: { version: { increment: 1 } },
  });
  await expect(
    retention.evaluateMediaRetention(item.input),
  ).resolves.toMatchObject({ reason: "owner_asset_confirmation_obsolete" });
});

test("subtitle acquisition persists exact version evidence and replays without another download", async () => {
  const item = await fixture();
  await cluster.database.mediaRequest.updateMany({
    where: { mediaId: item.media.id },
    data: { subtitleLanguages: ["en", "zh-Hans"] },
  });
  await cluster.database.libraryAsset.update({
    where: { id: item.asset.id },
    data: { sourcePath: "/downloads/Fixture.2020.1080p.WEB-GROUP.mkv" },
  });
  await cluster.database.operation.create({
    data: {
      id: item.input.operationId,
      kind: "find_subtitles",
      payload: { recoveryEpoch: 0 },
    },
  });
  await cluster.database.mediaProvider.upsert({
    where: { id: "opensubtitles" },
    create: { id: "opensubtitles", enabled: true },
    update: { enabled: true },
  });
  let searches = 0;
  const subtitles = createSubtitleActivities(item.context, {
    opensubtitles: async () => {
      searches++;
      return {
        filename: "Fixture.2020.1080p.WEB-GROUP.en.srt",
        description: "human subtitles",
        actualLanguage: "en",
        forced: false,
        hearingImpaired: false,
        bytes: new TextEncoder().encode(
          "1\n00:00:01,000 --> 00:00:03,000\nHello\n",
        ),
      };
    },
  });
  const input = {
    operationId: item.input.operationId,
    assetId: item.asset.id,
    language: "en",
  };
  const first = await subtitles.findMediaSubtitles(input);
  expect(first.status).toBe("found");
  await expect(subtitles.findMediaSubtitles(input)).resolves.toEqual(first);
  expect(searches).toBe(1);
  const saved = await cluster.database.subtitleAsset.findUniqueOrThrow({
    where: { id: first.subtitleId ?? "missing" },
  });
  expect(saved.matchingEvidence).toMatchObject({
    exactMediaMatch: true,
    videoVersionMatch: true,
    assetChecksum: item.asset.checksum,
    recoveryEpoch: 0,
  });
  await cluster.database.operation.update({
    where: { id: item.input.operationId },
    data: { result: { subtitleDownload: { providerId: "opensubtitles" } } },
  });
  await expect(
    subtitles.findMediaSubtitles({ ...input, language: "zh-Hans" }),
  ).resolves.toMatchObject({
    status: "blocked",
    reason: "subtitle_download_outcome_unknown",
  });
  expect(searches).toBe(1);
});
