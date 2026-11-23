import {
  RawMatchSchema,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  ArtifactDescriptorSchema,
  type ArtifactKind,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { PublicReplayTimelineResponseSchema } from "@scout-for-lol/domain/artifacts/public-replay-timeline.ts";
import {
  PublicReplayAvailabilitySchema,
  PublicReplayDescriptorSchema,
} from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type configuration from "#src/configuration.ts";
import type * as FeatureFlags from "#src/configuration/flags.ts";
import { randomSecret, secretDigest } from "#src/scout-client/secrets.ts";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import type * as StorageModule from "#src/storage/s3-client.ts";
import { buildReplayContainerFixture } from "#src/testing/replay-container-fixture.ts";
import {
  createTestDatabase,
  dropTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

const { prisma, dbPath } = createTestDatabase("public-replay-timeline");
const objects = new Map<string, string>();
const replayObjects = new Map<string, { body: ArrayBuffer; digest: string }>();
const requestedPaths: string[] = [];
const bucket = "raw-fixture";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    requestedPaths.push(path);
    if (request.method === "PUT") {
      const digest = request.headers.get("x-amz-meta-sha256");
      if (digest === null) return new Response(null, { status: 400 });
      replayObjects.set(path, { body: await request.arrayBuffer(), digest });
      return new Response(null, { headers: { ETag: '"fixture"' } });
    }
    const replay = replayObjects.get(path);
    if (replay !== undefined)
      return new Response(replay.body, {
        headers: { "x-amz-meta-sha256": replay.digest },
      });
    const object = objects.get(path);
    return object === undefined
      ? new Response(null, { status: 404 })
      : new Response(object, {
          headers: { "Content-Type": "application/json" },
        });
  },
});

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration.ts", async (original) => {
  const actual = await original<{ default: typeof configuration }>();
  return { ...actual, default: { ...actual.default, s3BucketName: bucket } };
});
vi.mock("#src/configuration/flags.ts", async (original) => {
  const actual = await original<typeof FeatureFlags>();
  const isFeatureHardDisabled: typeof actual.isFeatureHardDisabled = (name) =>
    name !== "scout_client_ingestion" && actual.isFeatureHardDisabled(name);
  const isPolicyEnabled: typeof actual.isPolicyEnabled = async (
    name,
    attributes,
  ) =>
    name === "scout_client_ingestion" ||
    (await actual.isPolicyEnabled(name, attributes));
  return { ...actual, isFeatureHardDisabled, isPolicyEnabled };
});
vi.mock("#src/storage/s3-client.ts", async (original) => {
  const actual = await original<typeof StorageModule>();
  const client = actual.createS3Client({
    endpoint: server.url.toString(),
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
  });
  return { createS3Client: () => client };
});

const { handleReplayRoute } = await import("./http.ts");
const { resolveReplaySupport } = await import("./support.ts");
const { backfillReplayMetadata } = await import("./backfill.ts");
const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { rawArchiveReceiptRecord } =
  await import("#src/report-lake/durable-receipts.ts");
const { recordReceipt } =
  await import("#src/database/durable/receipt-repository.ts");
const { createS3Client } = await import("#src/storage/s3-client.ts");
const match = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const { matchId } = match.metadata;
const replayId = "58001d3b-f679-4bb6-9b3d-314900818b27";
const ownerId = DiscordAccountIdSchema.parse("123456789123456789");
const deviceToken = randomSecret("sct_");
const seededCompletion = new Date("2025-11-01T00:00:00Z");

// A recorded Riot match result and synthetic matched timeline/upload metadata.
// PostgreSQL, the route handler and the HTTP S3 client are the production code.
const timeline: RawTimeline = {
  metadata: match.metadata,
  info: {
    gameId: match.info.gameId,
    frameInterval: 60_000,
    participants: match.info.participants.map(({ participantId, puuid }) => ({
      participantId,
      puuid,
    })),
    frames: [
      {
        timestamp: 60_000,
        participantFrames: null,
        events: [
          { timestamp: 21_000, type: "CHAT", text: "private fixture message" },
          {
            timestamp: 29_000,
            type: "CHAMPION_KILL",
            killerId: 1,
            victimId: 8,
            position: { x: 117, y: 916 },
          },
          {
            timestamp: 31_000,
            type: "ELITE_MONSTER_KILL",
            killerTeamId: 100,
            monsterType: "DRAGON",
            monsterSubType: "AIR_DRAGON",
          },
        ],
      },
    ],
  },
};

async function archive(
  kind: ArtifactKind,
  payload: unknown,
  riotMatchId = matchId,
) {
  const key = `games/2025/11/01/${riotMatchId}/${kind}.json`;
  const path = `/${bucket}/${key}`;
  const body = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(body);
  objects.set(path, body);
  const result = await recordReceipt(
    prisma,
    rawArchiveReceiptRecord({
      matchId: riotMatchId,
      artifact: ArtifactDescriptorSchema.parse({
        key,
        kind,
        digest: computeSha256Digest(bytes),
        bytes: bytes.byteLength,
        contentType: "application/json",
        capturedAt: new Date("2025-11-01T00:00:00Z").toISOString(),
      }),
    }),
  );
  expect(result.outcome).toBe("applied");
  return path;
}

beforeAll(async () => {
  const clientFacts = {
    deviceName: "private-fixture-device",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "1.0.0",
    protocolVersion: 1,
  };
  await prisma.scoutClientReplayArtifact.create({
    data: {
      id: replayId,
      device: {
        create: {
          ...clientFacts,
          tokenDigest: secretDigest(deviceToken),
          owner: {
            create: {
              discordId: ownerId,
              discordUsername: "private-fixture-owner",
            },
          },
          pairing: {
            create: {
              ...clientFacts,
              expiresAt: new Date(),
              secretDigest: "d".repeat(64),
            },
          },
        },
      },
      platformId: match.info.platformId,
      gameId: String(match.info.gameId),
      digest: "e".repeat(64),
      objectKey: "private-replay-file.rofl",
      bytes: 100n,
      uploadState: "COMPLETED",
      completedAt: seededCompletion,
      gameBuild: match.info.gameVersion,
      protocol: "20e09df23c66b85e",
      durationSeconds: match.info.gameDuration,
      mapId: match.info.mapId,
      gameMode: match.info.gameMode,
      teamSizes: [5, 5],
    },
  });
  await registerReplayParticipant(match);
});

beforeEach(async () => {
  requestedPaths.length = 0;
  objects.clear();
  replayObjects.clear();
  await prisma.matchProcessingReceipt.deleteMany({
    where: { riotMatchId: matchId },
  });
  await prisma.replayPatchObservation.deleteMany();
  await prisma.scoutClientReplayArtifact.deleteMany({
    where: { id: { not: replayId } },
  });
  await prisma.scoutClientReplayArtifact.update({
    where: { id: replayId },
    data: { uploadState: "COMPLETED", completedAt: seededCompletion },
  });
});

afterAll(async () => {
  createS3Client().destroy();
  await server.stop(true);
  await dropTestDatabase(prisma, dbPath);
});

async function anonymousReplay(path: string): Promise<Response> {
  const url = new URL(path, "http://scout.test");
  const response = await handleReplayRoute(
    new Request(url.toString()),
    url,
    resolveReplaySupport,
  );
  if (response === null) throw new Error("Replay route is missing");
  return response;
}

function anonymousTimeline(id = replayId): Promise<Response> {
  return anonymousReplay(`/api/replays/${id}/timeline`);
}

test("looks up a completed upload and returns only allowlisted events from its verified archives", async () => {
  await archive("match", match);
  await archive("timeline", timeline);
  const response = await anonymousTimeline();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body: unknown = await response.json();
  const parsed = PublicReplayTimelineResponseSchema.parse(body);
  expect(parsed.timeline).toEqual({
    source: "riot_match_timeline",
    events: [
      {
        id: 0,
        timestampMs: 29_000,
        type: "CHAMPION_KILL",
        objective: null,
        teamId: null,
      },
      {
        id: 1,
        timestampMs: 31_000,
        type: "ELITE_MONSTER_KILL",
        objective: "AIR_DRAGON",
        teamId: 100,
      },
    ],
  });
  expect(requestedPaths).toEqual([
    `/${bucket}/games/2025/11/01/${matchId}/match.json`,
    `/${bucket}/games/2025/11/01/${matchId}/timeline.json`,
  ]);
});

test("an uploading replay ID cannot read archives", async () => {
  await archive("match", match);
  await archive("timeline", timeline);
  await prisma.scoutClientReplayArtifact.update({
    where: { id: replayId },
    data: { uploadState: "UPLOADING", completedAt: null },
  });
  const response = await anonymousTimeline();
  expect(response.status).toBe(404);
  expect(requestedPaths).toEqual([]);
});

test.each([
  [
    "different game",
    { ...timeline, info: { ...timeline.info, gameId: match.info.gameId + 1 } },
  ],
  [
    "client observation",
    { ...timeline, metadata: { ...timeline.metadata, dataVersion: "local-1" } },
  ],
])("keeps a %s timeline archive private", async (_reason, candidate) => {
  await archive("match", match);
  await archive("timeline", candidate);
  const response = await anonymousTimeline();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ timeline: null });
  expect(requestedPaths).toHaveLength(2);
});

test("a custom match result is rejected before the timeline is read", async () => {
  await archive("match", {
    ...match,
    info: { ...match.info, queueId: 0, gameType: "CUSTOM_GAME" },
  });
  await archive("timeline", timeline);
  const response = await anonymousTimeline();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ timeline: null });
  expect(requestedPaths).toHaveLength(1);
});

test("changed archive bytes fail verification even when content length is unchanged", async () => {
  await archive("match", match);
  const path = await archive("timeline", timeline);
  const body = objects.get(path);
  if (body === undefined) throw new Error("Missing stored timeline fixture");
  objects.set(path, body.replace("AIR_DRAGON", "BAD_DRAGON"));
  await expect(anonymousTimeline()).rejects.toMatchObject({
    reason: "digest-mismatch",
  });
  expect(requestedPaths).toHaveLength(2);
});

function replayBody(result: RawMatch, protocol: string) {
  const participant = result.info.participants[0];
  if (participant === undefined)
    throw new Error("Match fixture has no participants");
  const facts = {
    PUUID: participant.puuid,
    TEAM: participant.teamId,
    CHAMPIONS_KILLED: participant.kills,
    NUM_DEATHS: participant.deaths,
    ASSISTS: participant.assists,
    GOLD_EARNED: participant.goldEarned,
    GOLD_SPENT: participant.goldSpent,
    TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: participant.totalDamageDealtToChampions,
    MINIONS_KILLED: participant.totalMinionsKilled,
    VISION_SCORE: participant.visionScore,
    WARD_PLACED: participant.wardsPlaced,
    WARD_KILLED: participant.wardsKilled,
    LEVEL: participant.champLevel,
    WIN: participant.win ? "Win" : "Fail",
    ITEM0: participant.item0,
    ITEM1: participant.item1,
    ITEM2: participant.item2,
    ITEM3: participant.item3,
    ITEM4: participant.item4,
    ITEM5: participant.item5,
    ITEM6: participant.item6,
  };
  return buildReplayContainerFixture({
    headerVersion: result.info.gameVersion,
    protocol,
    chunkHeaderBytes: 18,
    compressionTag: 4,
    compressed: true,
    gameLength: result.info.gameDuration * 1000,
    participants: [
      Object.fromEntries(
        Object.entries(facts).map(([key, value]) => [key, String(value)]),
      ),
    ],
  });
}

async function registerReplayParticipant(result: RawMatch) {
  const participant = result.info.participants[0];
  if (participant === undefined)
    throw new Error("Match fixture has no participants");
  const now = new Date();
  const owner = {
    alias: `fixture-player-${result.info.gameId.toString()}`,
    serverId: DiscordGuildIdSchema.parse("987654321987654321"),
    creatorDiscordId: ownerId,
    createdTime: now,
    updatedTime: now,
  };
  await prisma.player.create({
    data: {
      ...owner,
      discordId: ownerId,
      accounts: {
        create: {
          ...owner,
          puuid: LeaguePuuidSchema.parse(participant.puuid),
          region: "AMERICA_NORTH",
        },
      },
    },
  });
}

function replayUpload(result: RawMatch, protocol: string) {
  const body = replayBody(result, protocol);
  const digest = computeSha256Digest(body);
  const gameId = String(result.info.gameId);
  const url = new URL(
    `/api/scout-client/v1/replays/${gameId}`,
    "http://scout.test",
  );
  const headers = {
    "Content-Type": "application/vnd.riot.rofl",
    "Content-Length": String(body.byteLength),
    "X-Scout-SHA256": digest,
    "X-Scout-Platform": result.info.platformId,
  };
  return { body, digest, gameId, url, headers };
}

async function acceptReplayUpload(upload: ReturnType<typeof replayUpload>) {
  const { body, digest, url, headers } = upload;
  const accepted = await handleScoutClientRoute(
    new Request(url.toString(), {
      method: "PUT",
      headers: { ...headers, Authorization: `Bearer ${deviceToken}` },
      body,
    }),
    url,
  );
  const receipt: unknown = await accepted?.json();
  expect(accepted?.status, JSON.stringify(receipt)).toBe(201);
  expect(receipt).toEqual({
    outcome: "accepted",
    digest,
    bytes: body.byteLength,
  });
  expect(replayObjects.size).toBe(1);
  return prisma.scoutClientReplayArtifact.findUniqueOrThrow({
    where: { digest },
  });
}

async function expectReplayContent(id: string, expected: Uint8Array) {
  const content = await anonymousReplay(`/api/replays/${id}/content`);
  expect(content.status).toBe(200);
  expect(new Uint8Array(await content.arrayBuffer())).toEqual(
    Uint8Array.from(expected),
  );
}

async function observePatch(
  platformId: string,
  patch: string,
  gameBuild: string,
) {
  await prisma.replayPatchObservation.create({
    data: {
      platformId,
      patch,
      gameBuild,
      sourceUrl: `https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/${platformId}/versions?platform=windows`,
      sourceSha256: "c".repeat(64),
      observedAt: new Date(),
    },
  });
}

test("legacy platform repair revalidates stored bytes and qualifies only the selected artifact", async () => {
  const gameBuild = "16.23.840.6595";
  const result = {
    ...match,
    info: { ...match.info, gameVersion: gameBuild },
  };
  await observePatch(result.info.platformId, "16.23", gameBuild);
  await archive("match", result);
  const upload = replayUpload(result, "8bbfcd5af2bc92db");
  const stored = await acceptReplayUpload(upload);
  const legacy = await prisma.scoutClientReplayArtifact.update({
    where: { id: stored.id },
    data: { platformId: null },
  });
  const other = await prisma.scoutClientReplayArtifact.findUniqueOrThrow({
    where: { id: replayId },
  });
  expect(other.gameId).toBe(stored.gameId);
  expect(other.platformId).toBe(result.info.platformId);
  const metadataResponse = await anonymousReplay(`/api/replays/${stored.id}`);
  const before = PublicReplayDescriptorSchema.parse(
    await metadataResponse.json(),
  );
  expect(before.matchId).toBeNull();
  expect(before.playback).toMatchObject({
    status: "incompatible",
    reason: "unqualified_platform",
  });

  expect(await backfillReplayMetadata(stored.id, false)).toEqual({
    replayId: stored.id,
    outcome: "validated_dry_run",
  });
  expect(
    await prisma.scoutClientReplayArtifact.findUniqueOrThrow({
      where: { id: stored.id },
    }),
  ).toEqual(legacy);
  expect(await backfillReplayMetadata(stored.id, true)).toEqual({
    replayId: stored.id,
    outcome: "updated",
  });
  const repaired = await prisma.scoutClientReplayArtifact.findUniqueOrThrow({
    where: { id: stored.id },
  });
  expect(repaired).toEqual({
    ...legacy,
    platformId: result.info.platformId,
    updatedAt: expect.any(Date),
  });
  expect(
    await prisma.scoutClientReplayArtifact.findUniqueOrThrow({
      where: { id: replayId },
    }),
  ).toEqual(other);
  const availabilityResponse = await anonymousReplay(
    `/api/replays?platformId=${result.info.platformId}&gameId=${stored.gameId}`,
  );
  const availability = PublicReplayAvailabilitySchema.parse(
    await availabilityResponse.json(),
  );
  expect(availability.replay).toMatchObject({
    replayId: stored.id,
    matchId: `${result.info.platformId}_${stored.gameId}`,
    playback: {
      status: "support_preparing",
      reason: "render_package_unavailable",
    },
  });
  await expectReplayContent(stored.id, upload.body);
  expect(await backfillReplayMetadata(stored.id, true)).toEqual({
    replayId: stored.id,
    outcome: "already_present",
  });
});

test.each([
  {
    headerVersion: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    latestPatch: null,
    reason: "patch_unobserved",
  },
  {
    headerVersion: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    latestPatch: "16.23",
    reason: "render_package_unavailable",
  },
])(
  "a paired Rift upload on $headerVersion becomes anonymously discoverable, downloadable, and analyzable",
  async ({ headerVersion, protocol, latestPatch, reason }) => {
    // The recorded match's build predates the supported storage layouts.
    const result = {
      ...match,
      info: { ...match.info, gameVersion: headerVersion },
    };
    if (latestPatch !== null)
      await observePatch(result.info.platformId, latestPatch, headerVersion);
    await archive("match", result);
    await archive("timeline", timeline);
    const upload = replayUpload(result, protocol);
    const { body, digest, gameId, url, headers } = upload;
    const denied = await handleScoutClientRoute(
      new Request(url.toString(), { method: "PUT", headers, body }),
      url,
    );
    expect(denied?.status).toBe(401);
    expect(requestedPaths).toEqual([]);

    const stored = await acceptReplayUpload(upload);
    expect(stored).toMatchObject({
      uploadState: "COMPLETED",
      gameBuild: headerVersion,
      gameId,
      protocol,
    });

    const availability = await anonymousReplay(
      `/api/replays?platformId=${match.info.platformId}&gameId=${gameId}`,
    );
    expect(availability.status).toBe(200);
    expect(
      PublicReplayAvailabilitySchema.parse(await availability.json()).replay,
    ).toMatchObject({
      replayId: stored.id,
      sha256: digest,
      durationSeconds: match.info.gameDuration,
      playback: { status: "support_preparing", latestPatch, reason },
    });
    await expectReplayContent(stored.id, body);
    const analysis = await anonymousTimeline(stored.id);
    expect(analysis.status).toBe(200);
    expect(
      PublicReplayTimelineResponseSchema.parse(await analysis.json()).timeline
        ?.events,
    ).toHaveLength(2);
  },
);

test("an ARAM Mayhem replay can be downloaded anonymously while playback and timeline are unavailable", async () => {
  const gameBuild = "16.23.839.9929";
  const protocol = "8bbfcd5af2bc92db";
  const { platformId } = match.info;
  const gameId = 123;
  const riotMatchId = RiotMatchIdSchema.parse(
    `${platformId}_${gameId.toString()}`,
  );
  const participants = match.info.participants.map((participant) => ({
    ...participant,
    puuid: `aram-mayhem-fixture-${participant.participantId.toString()}`.padEnd(
      78,
      "0",
    ),
    riotIdName: "fixture",
    riotIdGameName: "fixture",
    riotIdTagline: "TEST",
    summonerId: "fixture",
    summonerName: "fixture",
  }));
  const result = {
    metadata: {
      dataVersion: "2",
      matchId: riotMatchId,
      participants: participants.map(({ puuid }) => puuid),
    },
    info: {
      ...match.info,
      gameId,
      gameName: "aram-mayhem-fixture",
      gameVersion: gameBuild,
      mapId: 12,
      gameMode: "KIWI",
      queueId: 2400,
      participants,
    },
  };
  await registerReplayParticipant(result);
  const resultPath = await archive("match", result, riotMatchId);
  await archive(
    "timeline",
    {
      metadata: result.metadata,
      info: {
        ...timeline.info,
        gameId,
        participants: participants.map(({ participantId, puuid }) => ({
          participantId,
          puuid,
        })),
      },
    },
    riotMatchId,
  );
  await observePatch(platformId, "16.23", gameBuild);

  const upload = replayUpload(result, protocol);
  const stored = await acceptReplayUpload(upload);
  const availability = await anonymousReplay(
    `/api/replays?platformId=${platformId}&gameId=${upload.gameId}`,
  );
  expect(availability.status).toBe(200);
  expect(
    PublicReplayAvailabilitySchema.parse(await availability.json()).replay,
  ).toMatchObject({
    replayId: stored.id,
    gameBuild,
    protocol,
    sha256: upload.digest,
    mapId: 12,
    gameMode: "KIWI",
    playback: {
      status: "incompatible",
      latestPatch: "16.23",
      reason: "unsupported_map",
    },
  });
  await expectReplayContent(stored.id, upload.body);

  requestedPaths.length = 0;
  const analysis = await anonymousTimeline(stored.id);
  expect(analysis.status).toBe(200);
  expect(await analysis.json()).toEqual({ timeline: null });
  expect(requestedPaths).toEqual([resultPath]);
});
