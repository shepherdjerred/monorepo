import { afterAll, beforeAll, expect, test } from "vitest";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { createAutomationTestContext } from "#testing/automation.ts";
import { verifiedPublicationFixture } from "#automation/publication-proof/verified.test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { elapsedWarningClient } from "#automation/retention/fixtures/elapsed.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { PlexClient } from "#integrations/plex.ts";
import { DatabaseProviderRegistry } from "./providers.ts";
import type { MediaAutomationContext } from "./context.ts";
import { createRetentionActivities } from "./retention.ts";
import { createNotificationActivities } from "./notifications.ts";
import { createSubtitleActivities } from "./subtitles.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
}, 60_000);
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
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
      // The exact Plex preflight now rejects the inactive writer before claim.
      reason: "ownership_changed",
    });
    await cluster.database.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", recoveryEpoch: delivery.recoveryEpoch + 1 },
    });
    await expect(
      notifications.deliverMediaNotification(input),
    ).resolves.toMatchObject({
      status: "failed",
      // The restored epoch cannot reuse the old exact Plex binding.
      reason: "missing_binding",
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

async function fixture(episode = false, elapsedWarning = false) {
  const db = cluster.database;
  const produced = await verifiedPublicationFixture(
    db,
    createAutomationTestContext(db, cipher),
    undefined,
    episode
      ? (currentDb) => sharedTvFileFixture(currentDb, mappedPublicationFixture)
      : mappedPublicationFixture,
  );
  directories.push(produced.files.directory);
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: produced.files.media.id },
  });
  const user = await db.mediaUser.update({
    where: { id: produced.files.user.id },
    data: {
      email: "fixture@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
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
  const item = produced.items.get(media.id);
  if (item === undefined)
    throw new Error("Actual publication omitted its Plex item");
  const observation = {
    get watched() {
      return produced.state.watched === true;
    },
    set watched(value: boolean) {
      produced.state.watched = value;
    },
    get playing() {
      return produced.state.sessions.length > 0;
    },
    set playing(value: boolean) {
      produced.state.sessions = value ? [item] : [];
    },
    sends: 0,
    loseResponse: false,
    bounced: false,
  };
  const context: MediaAutomationContext = {
    ...produced.context,
    db: elapsedWarning ? elapsedWarningClient(db, [media.id]) : db,
    providers: new DatabaseProviderRegistry(db, cipher),
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
    asset: produced.asset,
    observation,
    produced,
    input: {
      operationId: crypto.randomUUID(),
      mediaId: media.id,
      generation: target.generation,
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
  // A separate producer establishes elapsed policy time at its original writes.
  // The fresh acceptance above remains immutable throughout this scenario.
  const due = await boundRetentionFixture(
    cluster.database,
    createAutomationTestContext(cluster.database, cipher),
  );
  directories.push(due.files.directory);
  const dueRetention = createRetentionActivities(due.context);
  const eligible = await dueRetention.evaluateMediaRetention(due.input);
  expect(eligible.status).toBe("quarantine");
  const decision = await cluster.database.retentionDecision.findUniqueOrThrow({
    where: { id: eligible.decisionId ?? "missing" },
  });
  const elapsedDelivery =
    await cluster.database.notificationDelivery.findFirstOrThrow({
      where: {
        userId: due.files.user.id,
        event: { kind: "retention_warning" },
      },
    });
  expect(decision.evidence).toMatchObject({
    activePlayback: false,
    recoveryEpoch: 0,
    warningEventId: elapsedDelivery.eventId,
  });
  const playing = due.items.get(due.files.media.id);
  if (playing === undefined)
    throw new Error("Actual retention Plex item missing");
  due.state.sessions = [playing];
  await expect(
    dueRetention.evaluateMediaRetention(due.input),
  ).resolves.toMatchObject({ reason: "active_playback" });
  due.state.sessions = [];
  await cluster.database.retentionHold.create({
    data: {
      userId: due.files.user.id,
      mediaId: due.files.media.id,
      isPin: true,
    },
  });
  await expect(
    dueRetention.evaluateMediaRetention(due.input),
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
  const item = await fixture(false, true);
  const retention = createRetentionActivities(item.context);
  const notifications = createNotificationActivities(item.context);
  await retention.evaluateMediaRetention(item.input);
  const delivery = await cluster.database.notificationDelivery.findFirstOrThrow(
    { where: { userId: item.user.id } },
  );
  const input = { operationId: "notification", notificationId: delivery.id };
  await notifications.deliverMediaNotification(input);
  await retention.evaluateMediaRetention(item.input);
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
    {
      publicOrigin: item.context.publicOrigin,
      plexAccess: item.context.plexAccess,
      movieAccess: () =>
        Promise.resolve({
          serverMachineId: "fixture-server",
          movieSectionId: "1",
        }),
    },
  );
  const now = Date.now();
  await service.retryDelivery(
    { ...item.user, role: "member" },
    crypto.randomUUID(),
    delivery.id,
    bounced.version,
  );
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
  const item = await fixture(true);
  const other = await cluster.database.mediaItem.findFirstOrThrow({
    where: {
      id: { not: item.media.id },
      assets: { some: { assetId: item.asset.id, current: true } },
    },
  });
  const otherItem = item.produced.items.get(other.id);
  if (otherItem === undefined)
    throw new Error("Shared publication omitted its second binding");
  item.produced.state.watchOverrides.set(otherItem.ratingKey, false);
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
    where: { mediaId_edition: { mediaId: item.media.id, edition: "default" } },
    data: { desiredPresence: false },
  });
  const confirmedMedia = await cluster.database.mediaItem.findUniqueOrThrow({
    where: { id: item.media.id },
  });
  const confirmedIntent = await cluster.database.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: item.media.id, edition: "default" } },
  });
  const ownerOverride = {
    ownerId: item.user.id,
    media: [
      {
        id: item.media.id,
        title: item.media.title,
        version: confirmedMedia.version,
        generation: confirmedIntent.generation,
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
