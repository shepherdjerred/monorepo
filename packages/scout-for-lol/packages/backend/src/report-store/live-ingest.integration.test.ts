import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  LeaguePuuidSchema,
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  RawTimelineSchema,
  type DiscordAccountId,
  type LeaguePuuid,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import {
  recordMatchForReportStore,
  recordPrematchForReportStore,
  recordTimelineForReportStore,
} from "#src/report-store/live-ingest.ts";

const { prisma } = createTestDatabase("report-store-live-ingest-test");
const serverId = testGuildId("779");
const creatorDiscordId = testAccountId("779");

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

function createTimelineFixture(match: RawMatch): RawTimeline {
  return RawTimelineSchema.parse({
    metadata: {
      dataVersion: "2",
      matchId: match.metadata.matchId,
      participants: match.metadata.participants,
    },
    info: {
      frameInterval: 60_000,
      frames: [{ events: [], participantFrames: null, timestamp: 0 }],
      gameId: match.info.gameId,
      participants: match.metadata.participants.map((puuid, index) => ({
        participantId: index + 1,
        puuid,
      })),
    },
  });
}

async function createTrackedPlayer(params: {
  alias: string;
  puuid: LeaguePuuid;
  discordId: DiscordAccountId;
}) {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: params.alias,
      discordId: params.discordId,
      serverId,
      creatorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });

  await prisma.account.create({
    data: {
      alias: params.alias,
      puuid: params.puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function cleanup() {
  await deleteIfExists(() => prisma.prematchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedPrematch.deleteMany());
  await deleteIfExists(() => prisma.storedMatchTimeline.deleteMany());
  await deleteIfExists(() => prisma.storedMatch.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("live report-store ingestion", () => {
  test("records live matches idempotently without S3 import flags", async () => {
    const match = await loadMatchFixture();
    const participant = match.info.participants[0];
    expect(participant).toBeDefined();
    if (participant === undefined) {
      throw new Error("fixture has no participants");
    }

    await createTrackedPlayer({
      alias: "Live Match Player",
      puuid: LeaguePuuidSchema.parse(participant.puuid),
      discordId: testAccountId("301"),
    });

    const first = await recordMatchForReportStore({
      prisma,
      match,
      source: "test_live_match",
    });
    const second = await recordMatchForReportStore({
      prisma,
      match,
      source: "test_live_match",
    });

    expect(first.status).toBe("stored");
    expect(second.status).toBe("stored");
    expect(await prisma.storedMatch.count()).toBe(1);
    expect(await prisma.matchParticipantFact.count()).toBe(1);

    const storedMatch = await prisma.storedMatch.findFirstOrThrow();
    expect(storedMatch.importedFromS3).toBe(false);
    expect(storedMatch.s3Key).toBeNull();
  });

  test("records live timelines idempotently", async () => {
    const match = await loadMatchFixture();
    const timeline = createTimelineFixture(match);

    await recordTimelineForReportStore({
      prisma,
      timeline,
      source: "test_live_timeline",
    });
    await recordTimelineForReportStore({
      prisma,
      timeline,
      source: "test_live_timeline",
    });

    expect(await prisma.storedMatchTimeline.count()).toBe(1);
    const storedTimeline = await prisma.storedMatchTimeline.findFirstOrThrow();
    expect(storedTimeline.matchId).toBe(match.metadata.matchId);
    expect(storedTimeline.importedFromS3).toBe(false);
  });

  test("records live prematches idempotently by platform and game id", async () => {
    const puuid = testPuuid("live-prematch");
    await createTrackedPlayer({
      alias: "Live Prematch Player",
      puuid,
      discordId: testAccountId("302"),
    });
    const gameInfo = RawCurrentGameInfoSchema.parse({
      gameId: 9_000_000_002,
      gameStartTime: Date.UTC(2026, 4, 22, 18, 0, 0),
      gameMode: "CLASSIC",
      mapId: 11,
      gameType: "MATCHED_GAME",
      gameQueueConfigId: 420,
      gameLength: -30,
      platformId: "NA1",
      bannedChampions: [],
      participants: [
        {
          championId: 222,
          puuid,
          teamId: 100,
          riotId: "LivePrematch#NA1",
          spell1Id: 4,
          spell2Id: 7,
          lastSelectedSkinIndex: 1,
          bot: false,
          profileIconId: 10,
        },
      ],
    });

    await recordPrematchForReportStore({
      prisma,
      gameInfo,
      observedAt: new Date("2026-05-22T18:00:00.000Z"),
      source: "test_live_prematch",
    });
    await recordPrematchForReportStore({
      prisma,
      gameInfo,
      observedAt: new Date("2026-05-22T18:01:00.000Z"),
      source: "test_live_prematch",
    });

    expect(await prisma.storedPrematch.count()).toBe(1);
    expect(await prisma.prematchParticipantFact.count()).toBe(1);
    const storedPrematch = await prisma.storedPrematch.findFirstOrThrow();
    expect(storedPrematch.dedupeKey).toBe("NA1:9000000002");
    expect(storedPrematch.observedAt).toEqual(
      new Date("2026-05-22T18:01:00.000Z"),
    );
    const fact = await prisma.prematchParticipantFact.findFirstOrThrow();
    expect(fact.puuid).toBe(puuid);
    expect(fact.riotId).toBe("LivePrematch#NA1");
  });

  test("preserves archive provenance when duplicate live payloads arrive", async () => {
    const match = await loadMatchFixture();
    const timeline = createTimelineFixture(match);
    const puuid = testPuuid("live-after-archive");
    const gameInfo = RawCurrentGameInfoSchema.parse({
      gameId: 9_000_000_003,
      gameStartTime: Date.UTC(2026, 4, 22, 19, 0, 0),
      gameMode: "CLASSIC",
      mapId: 11,
      gameType: "MATCHED_GAME",
      gameQueueConfigId: 420,
      gameLength: -30,
      platformId: "NA1",
      bannedChampions: [],
      participants: [
        {
          championId: 222,
          puuid,
          teamId: 100,
          riotId: "ArchivedPrematch#NA1",
          spell1Id: 4,
          spell2Id: 7,
          lastSelectedSkinIndex: 1,
          bot: false,
          profileIconId: 10,
        },
      ],
    });

    await recordMatchForReportStore({
      prisma,
      match,
      source: "test_s3_match",
      importedFromS3: true,
      s3Key: "games/NA1_5370969615.json",
    });
    await recordMatchForReportStore({
      prisma,
      match,
      source: "test_live_match",
    });
    await recordTimelineForReportStore({
      prisma,
      timeline,
      source: "test_s3_timeline",
      importedFromS3: true,
      s3Key: "timelines/NA1_5370969615.json",
    });
    await recordTimelineForReportStore({
      prisma,
      timeline,
      source: "test_live_timeline",
    });
    await recordPrematchForReportStore({
      prisma,
      gameInfo,
      observedAt: new Date("2026-05-22T19:00:00.000Z"),
      source: "test_s3_prematch",
      importedFromS3: true,
      s3Key: "prematch/NA1/9000000003.json",
    });
    await recordPrematchForReportStore({
      prisma,
      gameInfo,
      observedAt: new Date("2026-05-22T19:01:00.000Z"),
      source: "test_live_prematch",
    });

    const storedMatch = await prisma.storedMatch.findFirstOrThrow();
    expect(storedMatch.importedFromS3).toBe(true);
    expect(storedMatch.s3Key).toBe("games/NA1_5370969615.json");

    const storedTimeline = await prisma.storedMatchTimeline.findFirstOrThrow();
    expect(storedTimeline.importedFromS3).toBe(true);
    expect(storedTimeline.s3Key).toBe("timelines/NA1_5370969615.json");

    const storedPrematch = await prisma.storedPrematch.findFirstOrThrow();
    expect(storedPrematch.importedFromS3).toBe(true);
    expect(storedPrematch.s3Key).toBe("prematch/NA1/9000000003.json");
    expect(storedPrematch.observedAt).toEqual(
      new Date("2026-05-22T19:01:00.000Z"),
    );
  });
});
