import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import { beforeEach, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import { REPLAY_UPLOAD_LEASE_MS } from "./replay-lease.ts";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { validateReplayContainer } from "./replay/container.ts";
import { buildReplayContainerFixture } from "#src/testing/replay-container-fixture.ts";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  create: vi.fn(),
  executeRaw: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  accountFindMany: vi.fn(),
  aliasFindMany: vi.fn(),
  archiveDescriptor: vi.fn(),
  archivedMatch: vi.fn(),
  selectedLocalMatch: vi.fn(),
  updateMany: vi.fn(),
  send: vi.fn(),
}));

vi.mock("#src/configuration.ts", () => ({
  default: { s3BucketName: "replay-test" },
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    $transaction: async (callback: (transaction: unknown) => unknown) =>
      callback({
        $executeRaw: mocks.executeRaw,
        scoutClientReplayArtifact: {
          aggregate: mocks.aggregate,
          create: mocks.create,
          findUnique: mocks.findUnique,
          updateMany: mocks.updateMany,
        },
      }),
    scoutClientObservation: { findMany: mocks.findMany },
    account: { findMany: mocks.accountFindMany },
    leagueIdentityAlias: { findMany: mocks.aliasFindMany },
    scoutClientReplayArtifact: {
      aggregate: mocks.aggregate,
      create: mocks.create,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ send: mocks.send }),
}));

vi.mock("#src/report-lake/durable-receipts.ts", () => ({
  storedRawArchiveDescriptor: mocks.archiveDescriptor,
}));

vi.mock("#src/report-lake/receipted-archive.ts", () => ({
  readArchivedMatchPayload: mocks.archivedMatch,
}));

vi.mock("./canonical-match.ts", () => ({
  readSelectedLocalCanonicalMatch: mocks.selectedLocalMatch,
}));

const { MAX_OWNER_REPLAYS_PER_DAY, uploadReplay } =
  await import("./replay-upload.ts");

const LOCAL_PUUID = "p".repeat(78);
const LEAGUE_PATCH = "16.14.794.5912";
const MATCH_STATS = {
  kills: 2,
  deaths: 5,
  assists: 3,
  goldEarned: 10_184,
  goldSpent: 9500,
  totalDamageDealtToChampions: 15_000,
  totalMinionsKilled: 143,
  visionScore: 20,
  wardsPlaced: 8,
  wardsKilled: 3,
  champLevel: 14,
  win: "Win",
  item0: 1001,
  item1: 2002,
  item2: 3003,
  item3: 4004,
  item4: 5005,
  item5: 6006,
  item6: 7007,
} as const;
const MATCH_HISTORY = {
  gameId: 123,
  gameDuration: 60,
  participantIdentities: [{ participantId: 1, player: { puuid: LOCAL_PUUID } }],
  participants: [
    {
      participantId: 1,
      teamId: 100,
      stats: MATCH_STATS,
    },
  ],
} as const;

const DEVICE: AuthenticatedScoutClient = {
  deviceId: "9d1e9752-b938-4293-8466-21cb523410a5",
  ownerId: DiscordAccountIdSchema.parse("160509172704739328"),
  appVersion: "0.1.0",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aggregate.mockResolvedValue({
    _count: { _all: 0 },
    _sum: { bytes: null },
  });
  mocks.executeRaw.mockResolvedValue(1);
  // Prisma answers null, not undefined, for a row that is not there.
  mocks.findUnique.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: LEAGUE_PATCH,
      payload: {
        resource: "match_history_game:123",
        data: MATCH_HISTORY,
      },
    },
  ]);
  mocks.create.mockResolvedValue({ id: "artifact-id" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.send.mockResolvedValue({});
  // By default the owner has one registered account and the server holds no
  // archived match, so the observation path is the only evidence.
  mocks.accountFindMany.mockResolvedValue([
    { puuid: LOCAL_PUUID, region: "AMERICA_NORTH" },
  ]);
  mocks.archiveDescriptor.mockResolvedValue(null);
  mocks.selectedLocalMatch.mockResolvedValue(null);
  mocks.aliasFindMany.mockResolvedValue([]);
});

function replayFixture(
  puuid = LOCAL_PUUID,
  goldEarned = MATCH_STATS.goldEarned.toString(),
  headerVersion = LEAGUE_PATCH,
  options: {
    chunkHeaderBytes?: 17 | 18;
    protocol?: string;
    compressionTag?: number;
    compressed?: boolean;
    outcome?: string;
  } = {},
): Uint8Array {
  return buildReplayContainerFixture({
    ...options,
    headerVersion,
    protocol: options.protocol ?? "509c49fd988fca11",
    gameLength: 60_000,
    participants: [
      {
        PUUID: puuid,
        TEAM: "100",
        CHAMPIONS_KILLED: MATCH_STATS.kills.toString(),
        NUM_DEATHS: MATCH_STATS.deaths.toString(),
        ASSISTS: MATCH_STATS.assists.toString(),
        GOLD_EARNED: goldEarned,
        GOLD_SPENT: MATCH_STATS.goldSpent.toString(),
        TOTAL_DAMAGE_DEALT_TO_CHAMPIONS:
          MATCH_STATS.totalDamageDealtToChampions.toString(),
        MINIONS_KILLED: MATCH_STATS.totalMinionsKilled.toString(),
        VISION_SCORE: MATCH_STATS.visionScore.toString(),
        WARD_PLACED: MATCH_STATS.wardsPlaced.toString(),
        WARD_KILLED: MATCH_STATS.wardsKilled.toString(),
        LEVEL: MATCH_STATS.champLevel.toString(),
        WIN: options.outcome ?? MATCH_STATS.win,
        ITEM0: MATCH_STATS.item0.toString(),
        ITEM1: MATCH_STATS.item1.toString(),
        ITEM2: MATCH_STATS.item2.toString(),
        ITEM3: MATCH_STATS.item3.toString(),
        ITEM4: MATCH_STATS.item4.toString(),
        ITEM5: MATCH_STATS.item5.toString(),
        ITEM6: MATCH_STATS.item6.toString(),
      },
    ],
  });
}

function replayRequest(body: Uint8Array): Request {
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  return new Request("https://scout.invalid/api/scout-client/v1/replays/123", {
    method: "PUT",
    headers: {
      "Content-Type": "application/vnd.riot.rofl",
      "Content-Length": body.byteLength.toString(),
      "X-Scout-SHA256": digest,
    },
    body,
  });
}

test("atomically reclaims a replay upload whose lease expired", async () => {
  const body = replayFixture();
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  const staleAt = new Date(Date.now() - REPLAY_UPLOAD_LEASE_MS - 1);
  const stale = {
    id: crypto.randomUUID(),
    uploadState: "UPLOADING",
    gameId: "123",
    digest,
    bytes: BigInt(body.byteLength),
    updatedAt: staleAt,
    objectKey: "legacy/replays/123.rofl",
  };
  mocks.findUnique.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
  const request = replayRequest(body);
  const previousPath = path.join(tmpdir(), `scout-replay-${stale.id}.rofl`);
  const previousBytes = Buffer.from("partial bytes from the previous attempt");
  await writeFile(previousPath, previousBytes, { flag: "wx" });
  try {
    await expect(uploadReplay(request, "123", DEVICE)).resolves.toEqual({
      outcome: "accepted",
      digest,
      bytes: body.byteLength,
    });
    expect(await readFile(previousPath)).toEqual(previousBytes);
  } finally {
    await unlink(previousPath);
  }

  expect(mocks.updateMany).toHaveBeenCalledTimes(2);
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ Key: "legacy/replays/123.rofl" }),
    }),
  );
  expect(mocks.updateMany).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      where: expect.objectContaining({
        digest,
        OR: expect.arrayContaining([
          expect.objectContaining({ uploadState: "UPLOADING" }),
        ]),
      }),
      data: expect.objectContaining({ uploadState: "UPLOADING" }),
    }),
  );
  expect(mocks.updateMany).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: expect.objectContaining({
        id: stale.id,
        uploadState: "UPLOADING",
      }),
      data: expect.objectContaining({ uploadState: "COMPLETED" }),
    }),
  );
});

test("reclaims an exact legacy compression rejection under the normal upload lease and quota", async () => {
  const gameBuild = "16.23.840.6595";
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    gameBuild,
    {
      chunkHeaderBytes: 18,
      protocol: "8bbfcd5af2bc92db",
      compressed: true,
    },
  );
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  const rejected = {
    id: "artifact-id",
    platformId: "NA1",
    gameId: "123",
    uploadState: "REJECTED",
    lastError: "Replay chunk compression is invalid",
    objectKey: "legacy/replays/123.rofl",
  };
  mocks.findUnique.mockResolvedValue(rejected);
  const upload = () => uploadReplay(replayRequest(body), "123", DEVICE);
  mocks.findMany.mockResolvedValueOnce([]);
  await expect(upload()).rejects.toMatchObject({ status: 409 });
  expect(mocks.findUnique).not.toHaveBeenCalled();

  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: gameBuild,
      payload: { resource: "match_history_game:123", data: MATCH_HISTORY },
    },
  ]);
  mocks.aggregate.mockResolvedValueOnce({
    _count: { _all: MAX_OWNER_REPLAYS_PER_DAY },
    _sum: { bytes: null },
  });
  await expect(upload()).rejects.toMatchObject({ status: 429 });
  expect(mocks.updateMany).not.toHaveBeenCalled();

  mocks.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(upload()).rejects.toMatchObject({ status: 409 });
  expect(mocks.send).not.toHaveBeenCalled();

  await expect(upload()).resolves.toEqual({
    outcome: "accepted",
    digest,
    bytes: body.byteLength,
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
    where: {
      id: rejected.id,
      digest,
      gameId: "123",
      platformId: "NA1",
      uploadState: "REJECTED",
      lastError: "Replay chunk compression is invalid",
    },
    data: expect.objectContaining({
      uploadState: "UPLOADING",
      lastError: null,
      updatedAt: expect.any(Date),
    }),
  });
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      input: expect.objectContaining({ Key: rejected.objectKey }),
    }),
  );
  expect(mocks.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ uploadState: "COMPLETED", gameBuild }),
    }),
  );
});

test("a newly rejected invalid Zstandard frame stays terminal", async () => {
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    LEAGUE_PATCH,
    { compressed: true },
  );
  const replayHeaderBytes = 15 + LEAGUE_PATCH.length;
  body[replayHeaderBytes + 17] = 0;
  const upload = () => uploadReplay(replayRequest(body), "123", DEVICE);
  const lastError = "Replay chunk is missing its Zstandard frame marker";
  await expect(upload()).rejects.toMatchObject({
    status: 400,
    message: lastError,
  });
  expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ data: { uploadState: "REJECTED", lastError } }),
  );

  mocks.findUnique.mockResolvedValue({
    platformId: "NA1",
    gameId: "123",
    uploadState: "REJECTED",
    lastError,
  });
  await expect(upload()).rejects.toMatchObject({
    status: 400,
    message: lastError,
  });
  expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  expect(mocks.send).not.toHaveBeenCalled();
});

test("keeps a replay retryable until its post-game observation arrives", async () => {
  mocks.findMany.mockResolvedValue([]);

  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).rejects.toMatchObject({
    status: 409,
  });
  expect(mocks.create).not.toHaveBeenCalled();
});

/**
 * The handful of fields `replayProvenanceFromMatch` reads off a canonical
 * match. The archive reader is mocked, so the rest of `RawMatch` never has to
 * exist for this path.
 */
function archivedMatchFor(puuid: LeaguePuuid) {
  return {
    metadata: { dataVersion: "2", matchId: "NA1_123", participants: [puuid] },
    info: {
      gameId: 123,
      gameVersion: LEAGUE_PATCH,
      gameDuration: MATCH_HISTORY.gameDuration,
      participants: [
        {
          puuid,
          teamId: MATCH_HISTORY.participants[0].teamId,
          kills: MATCH_STATS.kills,
          deaths: MATCH_STATS.deaths,
          assists: MATCH_STATS.assists,
          goldEarned: MATCH_STATS.goldEarned,
          goldSpent: MATCH_STATS.goldSpent,
          totalDamageDealtToChampions: MATCH_STATS.totalDamageDealtToChampions,
          totalMinionsKilled: MATCH_STATS.totalMinionsKilled,
          visionScore: MATCH_STATS.visionScore,
          wardsPlaced: MATCH_STATS.wardsPlaced,
          wardsKilled: MATCH_STATS.wardsKilled,
          champLevel: MATCH_STATS.champLevel,
          // Riot spells the outcome as a boolean where the replay says "Win".
          win: true,
          item0: MATCH_STATS.item0,
          item1: MATCH_STATS.item1,
          item2: MATCH_STATS.item2,
          item3: MATCH_STATS.item3,
          item4: MATCH_STATS.item4,
          item5: MATCH_STATS.item5,
          item6: MATCH_STATS.item6,
        },
      ],
    },
  };
}

/**
 * The League client, its replays and its payloads all name a player by a
 * 36-character UUID; Riot and Scout use the 78-character PUUID.
 */
const LOCAL_LCU_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

/** Answer alias lookups by UUID and by PUUID, as Prisma would. */
function aliasesFor(rows: readonly { lcuUuid: string; puuid: LeaguePuuid }[]) {
  mocks.aliasFindMany.mockImplementation(
    async (query: {
      where: { lcuUuid?: { in: string[] }; puuid?: LeaguePuuid };
    }) =>
      rows.filter((row) =>
        query.where.puuid === undefined
          ? (query.where.lcuUuid?.in.includes(row.lcuUuid) ?? false)
          : row.puuid === query.where.puuid,
      ),
  );
}

test("accepts a replay that names its player by League-client UUID once aliased", async () => {
  // Every real replay is like this. The observation stores the translated
  // PUUID as its observer while its payload, like the replay, keeps the UUID.
  aliasesFor([
    { lcuUuid: LOCAL_LCU_UUID, puuid: LeaguePuuidSchema.parse(LOCAL_PUUID) },
  ]);
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: LEAGUE_PATCH,
      payload: {
        resource: "match_history_game:123",
        data: {
          ...MATCH_HISTORY,
          participantIdentities: [
            { participantId: 1, player: { puuid: LOCAL_LCU_UUID } },
          ],
        },
      },
    },
  ]);
  const body = replayFixture(LOCAL_LCU_UUID);
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).resolves.toEqual({ outcome: "accepted", digest, bytes: body.byteLength });
});

test("stores the replay at its declared length in the replay bucket", async () => {
  const body = replayFixture();

  await uploadReplay(replayRequest(body), "123", DEVICE);

  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({
    input: {
      Bucket: "replay-test",
      ContentLength: body.byteLength,
      ContentType: "application/vnd.riot.rofl",
    },
  });
});

test("serves an uploaded exact-build replay anonymously while its renderer is pending", async () => {
  const { handleReplayRoute } = await import("../replays/http.ts");
  const { resolveReplaySupport } = await import("../replays/support.ts");
  const replayId = crypto.randomUUID();
  const gameBuild = "16.23.840.6595";
  const protocol = "8bbfcd5af2bc92db";
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    gameBuild,
    { chunkHeaderBytes: 18, compressionTag: 4, protocol, compressed: true },
  );
  // The synthetic post-game source is a separate record from the ROFL input.
  const participants = Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    stats: MATCH_STATS,
  }));
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: gameBuild,
      payload: {
        resource: "match_history_game:123",
        data: {
          ...MATCH_HISTORY,
          mapId: 11,
          gameMode: "CLASSIC",
          participants,
          participantIdentities: participants.map(({ participantId }) => ({
            participantId,
            player: {
              puuid: participantId === 1 ? LOCAL_PUUID : String(participantId),
            },
          })),
        },
      },
    },
  ]);
  mocks.create.mockResolvedValue({ id: replayId });
  const putObject = vi.fn(async (command: PutObjectCommand) => {
    expect(command).toBeInstanceOf(PutObjectCommand);
    const { Body } = command.input;
    if (!(Body instanceof Readable))
      throw new TypeError("Expected a streamed replay upload");
    return {
      input: command.input,
      bytes: await buffer(Body),
    };
  });
  mocks.send.mockImplementationOnce(putObject);
  const upload = await uploadReplay(replayRequest(body), "123", DEVICE);
  expect(upload).toMatchObject({ outcome: "accepted", bytes: body.byteLength });

  // Reuse the claim, completion, and object produced by upload at the read boundary.
  const claim = mocks.create.mock.calls[0]?.[0].data;
  const completion = mocks.updateMany.mock.lastCall?.[0].data;
  expect(completion.uploadState).toBe("COMPLETED");
  mocks.findFirst.mockResolvedValue({ id: replayId, ...claim, ...completion });
  const stored = await putObject.mock.results[0]?.value;
  if (!stored) throw new Error("Expected a replay object in storage");
  expect(stored.bytes).toEqual(Buffer.from(body));
  mocks.send.mockImplementation((command: GetObjectCommand) => {
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Key).toBe(stored.input.Key);
    expect(command.input.Bucket).toBe(stored.input.Bucket);
    const range = command.input.Range;
    const bytes =
      range === undefined ? stored.bytes : stored.bytes.subarray(0, 4);
    if (range !== undefined) expect(range).toBe("bytes=0-3");
    return Promise.resolve({
      Body: { transformToWebStream: () => new Blob([bytes]).stream() },
      ContentLength: bytes.length,
      ContentRange:
        range === undefined
          ? undefined
          : `bytes 0-3/${Number(stored.bytes.length).toString()}`,
      Metadata: stored.input.Metadata,
    });
  });

  const now = new Date("2026-11-21T19:55:00Z");
  const renderPackage = vi.fn().mockResolvedValue(null);
  const support: Parameters<typeof handleReplayRoute>[2] = (replay) =>
    resolveReplaySupport(replay, {
      now: () => now,
      observation: () =>
        Promise.resolve({
          platformId: "NA1",
          patch: "16.23",
          gameBuild,
          sourceUrl:
            "https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/NA1/versions?platform=windows",
          sourceSha256: "c".repeat(64),
          observedAt: now.toISOString(),
        }),
      renderPackage,
    });
  async function read(suffix = "", headers: Record<string, string> = {}) {
    const url = new URL(
      `https://scout.invalid/api/replays/${replayId}${suffix}`,
    );
    return await handleReplayRoute(
      new Request(url.href, { headers }),
      url,
      support,
    );
  }

  const descriptor = await read();
  expect(descriptor?.status).toBe(200);
  expect(await descriptor?.json()).toEqual({
    replayId,
    matchId: "NA1_123",
    platformId: "NA1",
    gameId: "123",
    bytes: body.byteLength,
    sha256: upload.digest,
    gameBuild,
    protocol,
    durationSeconds: 60,
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    playback: {
      status: "support_preparing",
      latestPatch: "16.23",
      reason: "render_package_unavailable",
    },
  });
  expect(renderPackage).toHaveBeenCalledExactlyOnceWith(gameBuild, protocol);
  expect(mocks.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: replayId, uploadState: "COMPLETED" },
    }),
  );
  const full = await read("/content");
  const partial = await read("/content", { Range: "bytes=0-3" });
  if (full === null || partial === null)
    throw new Error("Replay content route did not respond");
  expect(full.status).toBe(200);
  expect(Buffer.from(await full.arrayBuffer())).toEqual(Buffer.from(body));
  expect(partial.status).toBe(206);
  expect(partial.headers.get("Content-Range")).toBe(
    `bytes 0-3/${body.byteLength.toString()}`,
  );
  expect(Buffer.from(await partial.arrayBuffer())).toEqual(
    Buffer.from(body.subarray(0, 4)),
  );
});

test("records the storage failure it actually hit", async () => {
  // Every replay on beta failed this way, recorded only as "SeaweedFS upload
  // failed" while the real cause was an SDK checksum error.
  mocks.send.mockRejectedValueOnce(
    new Error("Unable to calculate hash for flowing readable stream"),
  );

  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).rejects.toThrow("flowing readable stream");
  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: {
        uploadState: "FAILED",
        lastError:
          "storage upload failed: Error: Unable to calculate hash for flowing readable stream",
      },
    }),
  );
});

test("accepts a replay whose header zero-pads the build revision", async () => {
  // Zero-padding does not select another build or transport layout.
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    "16.14.794.05912",
  );

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).resolves.toMatchObject({ outcome: "accepted" });
});

test("still refuses a replay from a different build", async () => {
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    "16.14.795.5912",
  );

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({ status: 403 });
});

for (const compressed of [false, true]) {
  test(`accepts the observed 18-byte transport with ${compressed ? "compressed" : "uncompressed"} chunks`, async () => {
    const build = "16.21.829.8620";
    mocks.findMany.mockResolvedValue([
      {
        localPuuid: LOCAL_PUUID,
        platformId: "NA1",
        leaguePatch: build,
        payload: { resource: "match_history_game:123", data: MATCH_HISTORY },
      },
    ]);
    const body = replayFixture(
      LOCAL_PUUID,
      MATCH_STATS.goldEarned.toString(),
      build,
      {
        chunkHeaderBytes: 18,
        protocol: "20e09df23c66b85e",
        compressed,
      },
    );
    await expect(
      uploadReplay(replayRequest(body), "123", DEVICE),
    ).resolves.toMatchObject({ outcome: "accepted" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
}

test.each(["16.23.839.9929", "16.23.840.6595"])(
  "stores the observed %s container with independently supplied match metadata",
  async (gameBuild) => {
    const protocol = "8bbfcd5af2bc92db";
    mocks.findMany.mockResolvedValue([
      {
        localPuuid: LOCAL_PUUID,
        platformId: "NA1",
        leaguePatch: gameBuild,
        payload: {
          resource: "match_history_game:123",
          data: { ...MATCH_HISTORY, mapId: 12, gameMode: "ARAM" },
        },
      },
    ]);
    const body = replayFixture(
      LOCAL_PUUID,
      MATCH_STATS.goldEarned.toString(),
      gameBuild,
      {
        chunkHeaderBytes: 18,
        compressionTag: 4,
        protocol,
        compressed: true,
      },
    );
    await expect(
      uploadReplay(replayRequest(body), "123", DEVICE),
    ).resolves.toMatchObject({ outcome: "accepted" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          uploadState: "COMPLETED",
          gameBuild,
          protocol,
          mapId: 12,
          gameMode: "ARAM",
        }),
      }),
    );
  },
);

test("defers an unobserved build instead of classifying it as corrupt or assuming a legacy layout", async () => {
  const build = "16.22.834.8910";
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: build,
      payload: { resource: "match_history_game:123", data: MATCH_HISTORY },
    },
  ]);
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    build,
  );
  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({
    status: 503,
    message: expect.stringContaining("Unsupported container build/protocol"),
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ uploadState: "FAILED" }),
    }),
  );
});

test("binds a leaver's observed loss to canonical losing provenance", async () => {
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: LEAGUE_PATCH,
      payload: {
        resource: "match_history_game:123",
        data: {
          ...MATCH_HISTORY,
          participants: [
            {
              participantId: 1,
              teamId: 100,
              stats: { ...MATCH_STATS, win: "Fail" },
            },
          ],
        },
      },
    },
  ]);
  const body = replayFixture(LOCAL_PUUID, undefined, LEAGUE_PATCH, {
    outcome: "LeaverFail",
  });
  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).resolves.toMatchObject({ outcome: "accepted" });
  expect(mocks.send).toHaveBeenCalledOnce();
});

test.each([
  ["LeaverFail", 403, "Replay participant does not match the observed match"],
  ["UnknownOutcome", 400, "Replay participant metadata is invalid"],
])(
  "rejects footer outcome %s against winning provenance",
  async (outcome, status, message) => {
    const body = replayFixture(LOCAL_PUUID, undefined, LEAGUE_PATCH, {
      outcome,
    });
    await expect(
      uploadReplay(replayRequest(body), "123", DEVICE),
    ).rejects.toMatchObject({ status, message });
    expect(mocks.send).not.toHaveBeenCalled();
  },
);

test("rejects an incompatible protocol before storage", async () => {
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    LEAGUE_PATCH,
    { protocol: "20e09df23c66b85e" },
  );
  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({
    status: 400,
    message: expect.stringContaining("Unsupported container protocol"),
  });
  expect(mocks.send).not.toHaveBeenCalled();
});

for (const [build, protocol] of [
  ["16.18.817.5716", "f6a10af08504a7ee"],
  ["16.19.823.0722", "6bfab33e871a4a58"],
] as const) {
  test(`retains authenticated legacy upload storage for observed ${build}`, async () => {
    mocks.findMany.mockResolvedValue([
      {
        localPuuid: LOCAL_PUUID,
        platformId: "NA1",
        leaguePatch: build,
        payload: { resource: "match_history_game:123", data: MATCH_HISTORY },
      },
    ]);
    const body = replayFixture(
      LOCAL_PUUID,
      MATCH_STATS.goldEarned.toString(),
      build,
      { protocol },
    );
    await expect(
      uploadReplay(replayRequest(body), "123", DEVICE),
    ).resolves.toMatchObject({ outcome: "accepted" });
  });
}

test("rejects the wrong 18-byte compression tag before storage", async () => {
  const build = "16.21.829.8620";
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: build,
      payload: { resource: "match_history_game:123", data: MATCH_HISTORY },
    },
  ]);
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    build,
    { chunkHeaderBytes: 18, protocol: "20e09df23c66b85e", compressionTag: 3 },
  );
  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({
    status: 400,
    message: "Unsupported chunk compression tag 3",
  });
  expect(mocks.send).not.toHaveBeenCalled();
});

test("returns validated container identity and duration for artifact metadata", async () => {
  const build = "16.21.829.8620";
  const protocol = "20e09df23c66b85e";
  const body = replayFixture(
    LOCAL_PUUID,
    MATCH_STATS.goldEarned.toString(),
    build,
    {
      chunkHeaderBytes: 18,
      protocol,
      compressed: true,
    },
  );
  const filePath = path.join(
    tmpdir(),
    `scout-replay-container-${crypto.randomUUID()}.rofl`,
  );
  await writeFile(filePath, body);
  try {
    await expect(
      validateReplayContainer(filePath, body.byteLength, {
        localPuuid: LOCAL_PUUID,
        leaguePatch: build,
        gameDurationSeconds: MATCH_HISTORY.gameDuration,
        participant: {
          puuid: LeaguePuuidSchema.parse(LOCAL_PUUID),
          teamId: 100,
          kills: MATCH_STATS.kills,
          deaths: MATCH_STATS.deaths,
          assists: MATCH_STATS.assists,
          goldEarned: MATCH_STATS.goldEarned,
          goldSpent: MATCH_STATS.goldSpent,
          totalDamageDealtToChampions: MATCH_STATS.totalDamageDealtToChampions,
          totalMinionsKilled: MATCH_STATS.totalMinionsKilled,
          visionScore: MATCH_STATS.visionScore,
          wardsPlaced: MATCH_STATS.wardsPlaced,
          wardsKilled: MATCH_STATS.wardsKilled,
          championLevel: MATCH_STATS.champLevel,
          win: MATCH_STATS.win,
          items: [
            MATCH_STATS.item0,
            MATCH_STATS.item1,
            MATCH_STATS.item2,
            MATCH_STATS.item3,
            MATCH_STATS.item4,
            MATCH_STATS.item5,
            MATCH_STATS.item6,
          ],
        },
      }),
    ).resolves.toEqual({ gameBuild: build, protocol, durationSeconds: 60 });
  } finally {
    await unlink(filePath);
  }
});

test("refuses a UUID-named replay whose player has no alias", async () => {
  // Without the alias the replay cannot be tied to the uploader, and the
  // container check must stay exactly as strict as before.
  mocks.findMany.mockResolvedValue([]);
  mocks.archiveDescriptor.mockResolvedValue({ key: "raw/NA1_123.json" });
  mocks.archivedMatch.mockResolvedValue(
    archivedMatchFor(LeaguePuuidSchema.parse(LOCAL_PUUID)),
  );

  await expect(
    uploadReplay(replayRequest(replayFixture(LOCAL_LCU_UUID)), "123", DEVICE),
  ).rejects.toMatchObject({ status: 403 });
});

test("accepts a replay vouched for by Riot when no client observed the game", async () => {
  // The case that matters: a replay on disk from before this device was ever
  // paired. No client evidence exists and none ever will, but the server
  // archived the match from Riot and that is enough to vouch for the file.
  mocks.findMany.mockResolvedValue([]);
  mocks.archiveDescriptor.mockResolvedValue({ key: "raw/NA1_123.json" });
  mocks.archivedMatch.mockResolvedValue(
    archivedMatchFor(LeaguePuuidSchema.parse(LOCAL_PUUID)),
  );
  const body = replayFixture();
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).resolves.toEqual({
    outcome: "accepted",
    digest,
    bytes: body.byteLength,
  });
});

test("accepts evidence from another device belonging to the same owner", async () => {
  // Owner scope, not device scope: a second machine or a reinstall must still
  // be able to hand over a replay its owner is entitled to.
  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).resolves.toMatchObject({ outcome: "accepted" });
  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        device: { ownerId: DEVICE.ownerId },
      }),
    }),
  );
});

test("refuses a Riot match none of the owner's accounts played", async () => {
  mocks.findMany.mockResolvedValue([]);
  mocks.archiveDescriptor.mockResolvedValue({ key: "raw/NA1_123.json" });
  mocks.archivedMatch.mockResolvedValue(
    archivedMatchFor(LeaguePuuidSchema.parse("q".repeat(78))),
  );

  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.create).not.toHaveBeenCalled();
});

test("consumes the upload it refuses before the body is read", async () => {
  // This rejection happens three database round-trips before the first body
  // byte. Answering while the client is still sending leaves the reverse proxy
  // with an upstream close on a request it cannot replay, which reached the
  // desktop client as `502 Bad Gateway` rather than this 409.
  mocks.findMany.mockResolvedValue([]);
  const request = replayRequest(replayFixture());

  await expect(uploadReplay(request, "123", DEVICE)).rejects.toMatchObject({
    status: 409,
  });
  expect(request.bodyUsed).toBe(true);
});

test("consumes the upload a duplicate digest makes unnecessary", async () => {
  const body = replayFixture();
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  mocks.findUnique.mockResolvedValue({
    uploadState: "COMPLETED",
    gameId: "123",
    digest,
    bytes: BigInt(body.byteLength),
    updatedAt: new Date(),
  });
  const request = replayRequest(body);

  await expect(uploadReplay(request, "123", DEVICE)).resolves.toMatchObject({
    outcome: "already_accepted",
  });
  expect(request.bodyUsed).toBe(true);
});

test("requires the post-game payload to name the requested game", async () => {
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: LEAGUE_PATCH,
      payload: {
        resource: "match_history_game:124",
        data: { ...MATCH_HISTORY, gameId: 124 },
      },
    },
  ]);

  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.create).not.toHaveBeenCalled();
});

test("refuses replay evidence whose payload contradicts its qualified platform", async () => {
  mocks.findMany.mockResolvedValue([
    {
      localPuuid: LOCAL_PUUID,
      platformId: "NA1",
      leaguePatch: LEAGUE_PATCH,
      payload: {
        resource: "match_history_game:123",
        data: { ...MATCH_HISTORY, platformId: "EUW1" },
      },
    },
  ]);
  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.create).not.toHaveBeenCalled();
});

test("rejects a completed digest that belongs to another game", async () => {
  const body = replayFixture();
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  const completed = {
    id: "artifact-id",
    uploadState: "COMPLETED",
    gameId: "124",
    digest,
    bytes: BigInt(body.byteLength),
    updatedAt: new Date(),
  };
  mocks.findUnique.mockResolvedValue(completed);

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({ status: 400 });
  expect(mocks.send).not.toHaveBeenCalled();
});

test("rejects a failed digest that belongs to another game", async () => {
  const body = replayFixture();
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  mocks.findUnique.mockResolvedValue({
    id: "artifact-id",
    uploadState: "FAILED",
    gameId: "124",
    digest,
    bytes: BigInt(body.byteLength),
    lastError: "temporary storage failure",
    updatedAt: new Date(),
  });

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({ status: 400 });
  expect(mocks.updateMany).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

test("rejects cross-game completion that wins the replay claim race", async () => {
  const body = replayFixture();
  const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
    id: "artifact-id",
    uploadState: "COMPLETED",
    gameId: "124",
    digest,
    bytes: BigInt(body.byteLength),
    updatedAt: new Date(),
  });

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({ status: 400 });
  expect(mocks.send).not.toHaveBeenCalled();
});

test("rejects a replay whose embedded player does not match the observer", async () => {
  mocks.findUnique.mockResolvedValue(null);

  await expect(
    uploadReplay(replayRequest(replayFixture("q".repeat(78))), "123", DEVICE),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ uploadState: "REJECTED" }),
    }),
  );
});

test("rejects a replay whose player fingerprint belongs to another match", async () => {
  mocks.findUnique.mockResolvedValue(null);

  await expect(
    uploadReplay(
      replayRequest(replayFixture(LOCAL_PUUID, "9999")),
      "123",
      DEVICE,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ uploadState: "REJECTED" }),
    }),
  );
});

test("rejects a RIOT-prefixed body that is not a valid ROFL container", async () => {
  mocks.findUnique.mockResolvedValue(null);
  const body = new TextEncoder().encode("RIOT-not-a-replay");

  await expect(
    uploadReplay(replayRequest(body), "123", DEVICE),
  ).rejects.toMatchObject({
    status: 400,
  });
  expect(mocks.send).not.toHaveBeenCalled();
});

test("reserves replay volume under a per-owner daily quota", async () => {
  mocks.findUnique.mockResolvedValue(null);
  mocks.aggregate.mockResolvedValue({
    _count: { _all: MAX_OWNER_REPLAYS_PER_DAY },
    _sum: { bytes: 1n },
  });

  await expect(
    uploadReplay(replayRequest(replayFixture()), "123", DEVICE),
  ).rejects.toMatchObject({
    status: 429,
  });
  expect(mocks.aggregate).toHaveBeenCalledWith({
    where: expect.objectContaining({
      device: { ownerId: DEVICE.ownerId },
    }),
    _count: { _all: true },
    _sum: { bytes: true },
  });
  expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
