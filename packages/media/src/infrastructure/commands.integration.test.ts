import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaMediaApplication } from "./media-service.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaAuth } from "#application/media-auth.ts";
import { CredentialCipher, tokenHash } from "#application/security.ts";
import { PrismaAuthStore } from "./auth-store.ts";
import { randomBytes } from "node:crypto";
import { PrismaNotificationApplication } from "./notification-service.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { lockDefaultScopes } from "./editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

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
    await cluster.database.idempotencyRecord.findUniqueOrThrow({
      where: { userId_key: { userId: actor.id, key } },
    }),
  ).toMatchObject({
    requestHash: tokenHash(
      JSON.stringify({
        input: {
          includeFutureEpisodes: false,
          includeSpecials: false,
          mediaId: media.id,
          subtitleLanguages: ["en"],
        },
        kind: "request",
      }),
    ),
  });
  expect(
    await cluster.database.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
    }),
  ).toMatchObject({
    version: 0,
    generation: 1,
    editionRootId: media.id,
    desiredPresence: true,
    monitoring: true,
  });
  expect(
    await cluster.database.mediaItem.findUniqueOrThrow({
      where: { id: media.id },
    }),
  ).toMatchObject({ version: 1 });
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

test("catalog-only detail and release reads leave the target absent", async () => {
  const { actor, media } = await fixture();
  expect(await app.getMedia(actor, media.id)).toMatchObject({
    id: media.id,
    intent: null,
  });
  expect(await app.releases(actor, media.id)).toEqual([]);
  expect(
    await cluster.database.mediaIntent.count({ where: { mediaId: media.id } }),
  ).toBe(0);
  expect(
    await cluster.database.mediaEditionDefinition.count({
      where: { rootMediaId: media.id },
    }),
  ).toBe(0);
  expect(
    await cluster.database.mediaItem.findUniqueOrThrow({
      where: { id: media.id },
    }),
  ).toMatchObject({ version: 0 });
});

test("request and removal lists carry the root title's artwork; an episode row inherits its series'", async () => {
  const { actor, media: movie } = await fixture();
  const db = cluster.database;
  const art = {
    posterPath: "/listed-poster.jpg",
    backdropPath: "/listed-backdrop.jpg",
  };
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Listed series", ...art },
  });
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Listed season",
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Listed episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const rows = [];
  for (const mediaId of [episode.id, movie.id]) {
    await createTestDefaultTarget(db, mediaId);
    rows.push({
      request: await db.mediaRequest.create({
        data: { userId: actor.id, mediaId },
      }),
      decision: await db.retentionDecision.create({
        data: {
          mediaId,
          generation: 1,
          state: "grace_period",
          evidence: { recoveryEpoch: 0 },
        },
      }),
    });
  }
  const [inherited, own] = rows;
  if (inherited === undefined || own === undefined)
    throw new Error("Missing artwork list fixture");
  // The movie's artwork has not been observed yet.
  const none = { posterPath: null, backdropPath: null };
  const requests = await app.listRequests(actor);
  expect(requests.find((row) => row.id === inherited.request.id)).toMatchObject(
    {
      mediaId: episode.id,
      media: { id: episode.id, kind: "episode" },
      rootMediaId: series.id,
      artwork: art,
    },
  );
  expect(requests.find((row) => row.id === own.request.id)).toMatchObject({
    mediaId: movie.id,
    rootMediaId: movie.id,
    artwork: none,
  });
  const removals = await app.removals(actor);
  expect(removals.find((row) => row.id === inherited.decision.id)).toEqual({
    id: inherited.decision.id,
    mediaId: episode.id,
    rootMediaId: series.id,
    artwork: art,
    state: "grace_period",
    graceUntil: null,
    purgeAfter: null,
    media: { title: "Listed episode", kind: "episode", version: 0 },
  });
  expect(removals.find((row) => row.id === own.decision.id)).toMatchObject({
    mediaId: movie.id,
    rootMediaId: movie.id,
    artwork: none,
  });
});

test("a long series' episode claims cannot push a direct request off the request list", async () => {
  const { actor, media: movie } = await fixture();
  const db = cluster.database;
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Long series" },
  });
  const direct = [];
  for (const mediaId of [movie.id, series.id]) {
    await createTestDefaultTarget(db, mediaId);
    direct.push(
      await db.mediaRequest.create({ data: { userId: actor.id, mediaId } }),
    );
  }
  const sponsor = direct.at(-1);
  if (sponsor === undefined) throw new Error("Missing series request");
  // More episode claims than the list holds, every one newer than both asks.
  const episodes = await db.mediaItem.createManyAndReturn({
    data: Array.from({ length: 205 }, (_, index) => ({
      kind: "episode" as const,
      title: `Episode ${String(index + 1)}`,
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: index + 1,
    })),
    select: { id: true },
  });
  await db.$transaction(
    (tx) =>
      lockDefaultScopes(
        tx,
        episodes.map((episode) => defaultScope(episode.id)),
        { createMissing: true },
      ),
    { timeout: 60_000 },
  );
  await db.mediaRequest.updateMany({
    where: { id: { in: direct.map((request) => request.id) } },
    data: { updatedAt: new Date(Date.now() - 86_400_000) },
  });
  await db.mediaRequest.createMany({
    data: episodes.map((episode) => ({
      userId: actor.id,
      mediaId: episode.id,
      direct: false,
      sponsorRequestId: sponsor.id,
    })),
  });
  const listed = await app.listRequests(actor);
  expect(listed).toHaveLength(200);
  expect(
    listed
      .slice(0, 2)
      .map((row) => row.id)
      .sort(),
  ).toEqual(direct.map((request) => request.id).sort());
  expect(listed.slice(2).every((row) => row.media.kind === "episode")).toBe(
    true,
  );
});

test("Keep on orphan metadata protects without inventing lineage or acquisition authority", async () => {
  const { actor } = await fixture("owner");
  const media = await cluster.database.mediaItem.create({
    data: { kind: "episode", title: "Unresolved historical episode" },
  });
  await app.act(actor, crypto.randomUUID(), media.id, {
    action: "keep",
    expectedVersion: 0,
  });
  expect(
    await cluster.database.retentionHold.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: actor.id,
          mediaId: media.id,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ userId: actor.id });
  expect(
    await cluster.database.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
    }),
  ).toMatchObject({
    editionRootId: null,
    automationEpoch: -1,
    generation: 1,
    version: 0,
  });
  await expect(
    app.act(actor, crypto.randomUUID(), media.id, {
      action: "retry",
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "lineage_unresolved" });
  expect(
    await cluster.database.mediaItem.findUniqueOrThrow({
      where: { id: media.id },
    }),
  ).toMatchObject({ version: 1 });
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
    keepingPolicy: "temporary",
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
  await createTestDefaultTarget(cluster.database, media.id, {
    generation: 5,
    desiredPresence: false,
    monitoring: false,
    intentionallyRemovedAt: new Date(),
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
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
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
  await createTestDefaultTarget(cluster.database, media.id);
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

test("release responses strip private download and provider details and reach only the owner", async () => {
  const { actor, media } = await fixture("owner");
  const { actor: member } = await fixture();
  // A request names its default target, so the requester needs a real one.
  await createTestDefaultTarget(cluster.database, media.id);
  await cluster.database.mediaRequest.create({
    data: { userId: member.id, mediaId: media.id },
  });
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
  expect(releases[0]).toMatchObject({
    providerId: "private",
    title: "Example release",
  });
  // A requester's open title page still calls this read: empty, not refused.
  expect(await app.releases(member, media.id)).toEqual([]);
  // The stored role decides, not the role a signed-in session still carries.
  expect(await app.releases({ ...member, role: "owner" }, media.id)).toEqual(
    [],
  );
  await cluster.database.mediaUser.update({
    where: { id: actor.id },
    data: { role: "member" },
  });
  expect(await app.releases(actor, media.id)).toEqual([]);
  await expect(app.releases(member, crypto.randomUUID())).rejects.toMatchObject(
    { code: "media_not_found" },
  );
});
