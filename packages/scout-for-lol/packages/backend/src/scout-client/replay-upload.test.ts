import { beforeEach, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import { REPLAY_UPLOAD_LEASE_MS } from "./replay-lease.ts";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  create: vi.fn(),
  executeRaw: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  accountFindMany: vi.fn(),
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
    scoutClientReplayArtifact: {
      aggregate: mocks.aggregate,
      create: mocks.create,
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
const LEAGUE_PATCH = "16.18.817.5716";
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
});

function replayFixture(
  puuid = LOCAL_PUUID,
  goldEarned = MATCH_STATS.goldEarned.toString(),
): Uint8Array {
  const version = Buffer.from(LEAGUE_PATCH, "ascii");
  const header = Buffer.alloc(15);
  header.write("RIOT", 0, "ascii");
  header.writeUInt16LE(2, 4);
  header[14] = version.byteLength;
  const chunkHeader = Buffer.alloc(17);
  chunkHeader.writeUInt32LE(1, 0);
  chunkHeader[4] = 1;
  chunkHeader.writeUInt32LE(0x04_00_00_00, 5);
  chunkHeader.writeUInt32LE(1, 9);
  const metadata = Buffer.from(
    JSON.stringify({
      gameLength: 60_000,
      lastGameChunkId: 1,
      lastKeyFrameId: 0,
      statsJson: JSON.stringify([
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
          WIN: MATCH_STATS.win,
          ITEM0: MATCH_STATS.item0.toString(),
          ITEM1: MATCH_STATS.item1.toString(),
          ITEM2: MATCH_STATS.item2.toString(),
          ITEM3: MATCH_STATS.item3.toString(),
          ITEM4: MATCH_STATS.item4.toString(),
          ITEM5: MATCH_STATS.item5.toString(),
          ITEM6: MATCH_STATS.item6.toString(),
        },
      ]),
    }),
  );
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32LE(metadata.byteLength);
  return Buffer.concat([
    header,
    version,
    chunkHeader,
    Buffer.from([0]),
    Buffer.alloc(256, 1),
    metadata,
    metadataLength,
  ]);
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
    id: "artifact-id",
    uploadState: "UPLOADING",
    gameId: "123",
    digest,
    bytes: BigInt(body.byteLength),
    updatedAt: staleAt,
  };
  mocks.findUnique.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
  const request = replayRequest(body);

  await expect(uploadReplay(request, "123", DEVICE)).resolves.toEqual({
    outcome: "accepted",
    digest,
    bytes: body.byteLength,
  });

  expect(mocks.updateMany).toHaveBeenCalledTimes(2);
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
        id: "artifact-id",
        uploadState: "UPLOADING",
      }),
      data: expect.objectContaining({ uploadState: "COMPLETED" }),
    }),
  );
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
function archivedMatchFor(puuid: string) {
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

test("accepts a replay vouched for by Riot when no client observed the game", async () => {
  // The case that matters: a replay on disk from before this device was ever
  // paired. No client evidence exists and none ever will, but the server
  // archived the match from Riot and that is enough to vouch for the file.
  mocks.findMany.mockResolvedValue([]);
  mocks.archiveDescriptor.mockResolvedValue({ key: "raw/NA1_123.json" });
  mocks.archivedMatch.mockResolvedValue(archivedMatchFor(LOCAL_PUUID));
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
  mocks.archivedMatch.mockResolvedValue(archivedMatchFor("q".repeat(78)));

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
