import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaMediaApplication } from "./media-service.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaAuth } from "#application/auth.ts";
import { CredentialCipher, tokenHash } from "#application/security.ts";
import { PrismaAuthStore } from "./auth-store.ts";
import { randomBytes } from "node:crypto";
import { PrismaNotificationApplication } from "./notification-service.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let app: PrismaMediaApplication;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  app = new PrismaMediaApplication(cluster.database, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    visibilitySections: { movie: "1", series: "2" },
  });
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

async function fixture(role: "owner" | "member" = "member") {
  const actor = await cluster.database.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Test requester",
      role,
    },
  });
  const media = await cluster.database.mediaItem.create({
    data: { kind: "movie", title: "Example" },
  });
  await cluster.database.plexIdentityMapping.create({
    data: {
      userId: actor.id,
      serverMachineId: "fixture-server",
      serverAccountId: actor.plexAccountId,
      kind: "account",
      permittedSectionIds: ["1", "2"],
      permittedMediaKinds: ["movie", "series"],
      verifiedAt: new Date(),
    },
  });
  return { actor, media };
}

test("activity links only verified media targets, never delivery, cleanup or handoff identifiers", async () => {
  const { actor, media } = await fixture();
  for (const kind of [
    "reconcile_media",
    "deliver_notification",
    "cleanup_upgrade",
    "media_handoff_apply",
    "maintain_torrent",
  ])
    await cluster.database.operation.create({
      data: {
        idempotencyKey: crypto.randomUUID(),
        userId: actor.id,
        kind,
        targetId: media.id,
        payload: {},
      },
    });
  const activity = await app.activity({ ...actor, role: "member" });
  expect(
    activity.find((item) => item.kind === "reconcile_media")?.mediaId,
  ).toBe(media.id);
  expect(
    activity
      .filter((item) => item.kind !== "reconcile_media")
      .every((item) => item.mediaId === null),
  ).toBe(true);
});

test("concurrent identical commands create exactly one request and outbox entry", async () => {
  const { actor, media } = await fixture();
  const input = {
    mediaId: media.id,
    subtitleLanguages: ["en"],
    includeFutureEpisodes: false,
    includeSpecials: false,
  };
  const key = crypto.randomUUID();
  const responses = await Promise.all([
    app.createRequest(actor, key, input),
    app.createRequest(actor, key, input),
  ]);
  expect(responses[0]).toEqual(responses[1]);
  expect(
    await cluster.database.mediaRequest.count({
      where: { mediaId: media.id },
    }),
  ).toBe(1);
  expect(
    await cluster.database.operation.count({ where: { targetId: media.id } }),
  ).toBe(1);
  expect(
    await cluster.database.outboxCommand.count({
      where: { operation: { targetId: media.id } },
    }),
  ).toBe(1);
});

test("reusing a key with different input returns conflict without another mutation", async () => {
  const { actor, media } = await fixture();
  const key = crypto.randomUUID();
  const input = {
    mediaId: media.id,
    subtitleLanguages: [],
    includeSpecials: false,
  };
  await app.createRequest(actor, key, input);
  await expect(
    app.createRequest(actor, key, {
      ...input,
      subtitleLanguages: ["zh-Hans"],
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(
    await cluster.database.mediaRequest.count({
      where: { mediaId: media.id },
    }),
  ).toBe(1);
});

test("simultaneous version-guarded Keep and remove commands cannot both commit", async () => {
  const { actor, media } = await fixture("owner");
  await app.createRequest(actor, crypto.randomUUID(), {
    mediaId: media.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  const current = await cluster.database.mediaItem.findUniqueOrThrow({
    where: { id: media.id },
  });
  const results = await Promise.allSettled([
    app.act(actor, crypto.randomUUID(), media.id, {
      action: "keep",
      expectedVersion: current.version,
    }),
    app.act(actor, crypto.randomUUID(), media.id, {
      action: "remove",
      expectedVersion: current.version,
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
});

test("member cannot remove media or cancel another request", async () => {
  const first = await fixture();
  const second = await fixture();
  const result = await app.createRequest(first.actor, crypto.randomUUID(), {
    mediaId: first.media.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  if (!result.requestId) throw new Error("Request result missing ID");
  await expect(
    app.act(first.actor, crypto.randomUUID(), first.media.id, {
      action: "remove",
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    app.cancelRequest(second.actor, crypto.randomUUID(), result.requestId, 0),
  ).rejects.toMatchObject({ code: "forbidden" });
});

test("restriction is checked inside the transaction, not from the old session actor", async () => {
  const { actor, media } = await fixture();
  await cluster.database.mediaUser.update({
    where: { id: actor.id },
    data: { restricted: true },
  });
  await expect(
    app.createRequest(actor, crypto.randomUUID(), {
      mediaId: media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    }),
  ).rejects.toMatchObject({ code: "requests_restricted" });
  expect(
    await cluster.database.operation.count({ where: { targetId: media.id } }),
  ).toBe(0);
  expect(
    await cluster.database.idempotencyRecord.count({
      where: { userId: actor.id },
    }),
  ).toBe(0);
});

test("series claims cover episodes, omit specials, and monitor future episodes by default", async () => {
  const { actor } = await fixture();
  const series = await cluster.database.mediaItem.create({
    data: { kind: "series", title: "Series" },
  });
  const season = await cluster.database.mediaItem.create({
    data: {
      kind: "season",
      title: "Season",
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  const episode = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      title: "Episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const special = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      title: "Special",
      parentId: series.id,
      seasonNumber: 0,
      episodeNumber: 1,
    },
  });
  const result = await app.createRequest(actor, crypto.randomUUID(), {
    mediaId: series.id,
    subtitleLanguages: ["en"],
    includeSpecials: false,
  });
  if (result.requestId === undefined || result.operationId === undefined)
    throw new Error("Missing coverage operation");
  await createCoverageActivities({ db: cluster.database }).expandMediaRequest({
    operationId: result.operationId,
    requestId: result.requestId,
    requestVersion: 0,
    cursor: null,
  });
  const claims = await cluster.database.mediaRequest.findMany({
    where: { userId: actor.id, active: true },
  });
  expect(
    claims.find((claim) => claim.mediaId === series.id)?.includeFutureEpisodes,
  ).toBe(true);
  expect(
    claims.find((claim) => claim.mediaId === episode.id)?.sponsorRequestId,
  ).toBe(result.requestId);
  expect(claims.some((claim) => claim.mediaId === special.id)).toBe(false);
});

test("new requester cancels a pending cleanup and restores desired presence", async () => {
  const { actor, media } = await fixture();
  await cluster.database.mediaIntent.create({
    data: {
      mediaId: media.id,
      generation: 5,
      desiredPresence: false,
      monitoring: false,
      intentionallyRemovedAt: new Date(),
    },
  });
  const decision = await cluster.database.retentionDecision.create({
    data: {
      mediaId: media.id,
      generation: 5,
      state: "grace_period",
      evidence: {},
    },
  });
  await app.createRequest(actor, crypto.randomUUID(), {
    mediaId: media.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  expect(
    await cluster.database.retentionDecision.findUnique({
      where: { id: decision.id },
    }),
  ).toMatchObject({ state: "cancelled" });
  expect(
    await cluster.database.mediaIntent.findUnique({
      where: { mediaId: media.id },
    }),
  ).toMatchObject({
    generation: 6,
    desiredPresence: true,
    intentionallyRemovedAt: null,
  });
});

test("server access revocation invalidates an existing session", async () => {
  const { actor } = await fixture();
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  await cluster.database.credential.create({
    data: {
      userId: actor.id,
      kind: "plex",
      ciphertext: cipher.encrypt(
        JSON.stringify({
          token: "test-account-token",
          serverToken: "test-scoped-token",
          deviceState: "test-device",
        }),
        `plex:${actor.plexAccountId}`,
      ),
    },
  });
  await cluster.database.mediaSession.create({
    data: {
      id: tokenHash("session"),
      userId: actor.id,
      csrfHash: tokenHash("csrf"),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const auth = new MediaAuth(
    new PrismaAuthStore(cluster.database),
    {
      async createPin() {
        throw new Error("Not used");
      },
      async resolvePin() {
        throw new Error("Not used");
      },
      async resolveServerToken() {
        return null;
      },
      async resolveServerAccess() {
        return null;
      },
      async refresh() {
        throw new Error("Not used");
      },
    },
    cipher,
    { ownerAccountId: "owner", sessionLifetimeMs: 60_000 },
  );
  await expect(auth.authenticate("session")).rejects.toMatchObject({
    code: "server_access_revoked",
  });
  expect(
    await cluster.database.mediaSession.count({
      where: { userId: actor.id },
    }),
  ).toBe(0);
});

test("watch state is private to its requester", async () => {
  const { actor, media } = await fixture();
  const other = await fixture();
  await cluster.database.watchState.createMany({
    data: [
      {
        userId: actor.id,
        mediaId: media.id,
        watched: true,
        observedAt: new Date(),
        source: "plex",
      },
      {
        userId: other.actor.id,
        mediaId: media.id,
        watched: false,
        observedAt: new Date(),
        source: "plex",
      },
    ],
  });
  const detail = await app.getMedia(actor satisfies MediaActor, media.id);
  expect(detail.watchStates).toHaveLength(1);
  expect(detail.watchStates[0]?.userId).toBe(actor.id);
});

test("credential refresh cannot overwrite a newer device credential", async () => {
  const { actor } = await fixture();
  await cluster.database.credential.create({
    data: { userId: actor.id, kind: "plex", ciphertext: "new-device" },
  });
  const store = new PrismaAuthStore(cluster.database);
  expect(
    await store.updateCredential(actor.id, "stale-refresh", "old-device"),
  ).toBe(false);
  expect(
    await store.updateCredential(actor.id, "new-refresh", "new-device"),
  ).toBe(true);
  expect(
    await cluster.database.credential.findUnique({
      where: { userId_kind: { userId: actor.id, kind: "plex" } },
    }),
  ).toMatchObject({ ciphertext: "new-refresh" });
});

test("email verification queues only identifiers and cannot be used by a different account", async () => {
  const { actor } = await fixture();
  const other = await fixture();
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  const notifications = new PrismaNotificationApplication(
    cluster.database,
    cipher,
    null,
    { publicOrigin: "http://media.fixture" },
  );
  const result = await notifications.requestEmailVerification(
    actor,
    crypto.randomUUID(),
    "verified@example.test",
  );
  const pending = await cluster.database.emailVerification.findFirstOrThrow({
    where: { userId: actor.id },
  });
  const token = cipher.decrypt(pending.encryptedToken, `email:${pending.id}`);
  if (result.operationId === undefined) throw new Error("Operation ID missing");
  const command = await cluster.database.operation.findUniqueOrThrow({
    where: { id: result.operationId },
  });
  expect(JSON.stringify(command.payload)).not.toContain(token);
  expect(JSON.stringify(command.payload)).not.toContain(
    "verified@example.test",
  );
  await expect(
    notifications.verifyEmail(other.actor, token),
  ).rejects.toMatchObject({ code: "verification_invalid" });
  await notifications.verifyEmail(actor, token);
  expect(await notifications.preferences(actor)).toMatchObject({
    email: "verified@example.test",
    emailVerified: true,
    emailEnabled: false,
  });
  await expect(notifications.verifyEmail(actor, token)).rejects.toMatchObject({
    code: "verification_invalid",
  });
});

test("notification channels require proof and preference updates are versioned", async () => {
  const { actor } = await fixture();
  const notifications = new PrismaNotificationApplication(
    cluster.database,
    new CredentialCipher(randomBytes(32).toString("base64")),
    null,
    { publicOrigin: "http://media.fixture" },
  );
  const prefs = {
    emailEnabled: true,
    discordEnabled: false,
    upgrades: false,
    removalCompleted: false,
    expectedVersion: 0,
  };
  await expect(
    notifications.updatePreferences(actor, crypto.randomUUID(), prefs),
  ).rejects.toMatchObject({ code: "email_not_verified" });
  await notifications.updatePreferences(actor, crypto.randomUUID(), {
    ...prefs,
    emailEnabled: false,
    upgrades: true,
  });
  await expect(
    notifications.updatePreferences(actor, crypto.randomUUID(), {
      ...prefs,
      emailEnabled: false,
    }),
  ).rejects.toMatchObject({ code: "version_conflict" });
});

test("Discord account linking binds state to the authenticated user", async () => {
  const { actor } = await fixture();
  const other = await fixture();
  const notifications = new PrismaNotificationApplication(
    cluster.database,
    new CredentialCipher(randomBytes(32).toString("base64")),
    {
      authorizationUrl: (state) =>
        `https://discord.com/oauth2/authorize?state=${state}`,
      async exchangeCode() {
        return { id: "123456789012345678" };
      },
    },
    { publicOrigin: "http://media.fixture", discordEnabled: async () => true },
  );
  const { authorizationUrl } = await notifications.startDiscordLink(actor);
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (state === null) throw new Error("State missing");
  await expect(
    notifications.completeDiscordLink(other.actor, {
      code: "code",
      state,
      issuer: "https://discord.com",
    }),
  ).rejects.toMatchObject({ code: "discord_state_invalid" });
  await notifications.completeDiscordLink(actor, {
    code: "code",
    state,
    issuer: "https://discord.com",
  });
  expect(await notifications.preferences(actor)).toMatchObject({
    discordLinked: true,
  });
  await expect(
    notifications.completeDiscordLink(actor, {
      code: "code",
      state,
      issuer: "https://discord.com",
    }),
  ).rejects.toMatchObject({ code: "discord_state_invalid" });
});

test("release responses strip private download and provider details", async () => {
  const { actor, media } = await fixture();
  await cluster.database.releaseCandidate.create({
    data: {
      providerId: "private",
      providerReleaseId: crypto.randomUUID(),
      title: "Example release",
      mediaIds: [media.id],
      attributes: {
        mediaIds: [media.id],
        identityConfidence: "exact",
        quality: "1080p",
        codec: "h264",
        audioLanguages: ["en"],
        sizeBytes: 1024,
        scoreTags: [],
        downloadUrl:
          "https://private.example/download?passkey=sensitive-fixture",
      },
      evaluation: {
        accepted: true,
        qualityRank: 1,
        score: 10,
        reasons: [],
        rawProviderResponse: { token: "sensitive-fixture" },
      },
    },
  });
  const releases = await app.releases(actor, media.id);
  expect(releases).toHaveLength(1);
  expect(JSON.stringify(releases)).not.toContain("sensitive-fixture");
  expect(JSON.stringify(releases)).not.toContain("downloadUrl");
});
