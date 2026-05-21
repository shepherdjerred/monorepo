import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  LeaguePuuidSchema,
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  type DiscordAccountId,
  type LeaguePuuid,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import {
  upsertStoredMatchWithFacts,
  upsertStoredPrematchWithFacts,
} from "#src/report-store/store.ts";
import {
  getMostGamesPlayedCompetitionLeaderboardFromSqlite,
  getSurrenderLeadersFromSqlite,
} from "#src/report-store/queries.ts";

const { prisma } = createTestDatabase("report-store-test");
const serverId = testGuildId("777");
const creatorDiscordId = testAccountId("777");

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
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

  return player;
}

async function cleanup() {
  await deleteIfExists(() => prisma.prematchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedPrematch.deleteMany());
  await deleteIfExists(() => prisma.storedMatchTimeline.deleteMany());
  await deleteIfExists(() => prisma.storedMatch.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("SQLite report store", () => {
  test("stores raw matches and creates idempotent match participant facts", async () => {
    const match = await loadMatchFixture();
    const participant = match.info.participants[0];
    expect(participant).toBeDefined();
    if (participant === undefined) {
      throw new Error("fixture has no participants");
    }

    await createTrackedPlayer({
      alias: "Top Laner",
      puuid: LeaguePuuidSchema.parse(participant.puuid),
      discordId: testAccountId("101"),
    });

    await upsertStoredMatchWithFacts(prisma, match, {
      s3Key: "games/2023/11/15/NA1_123/match.json",
      importedFromS3: true,
    });
    await upsertStoredMatchWithFacts(prisma, match, {
      s3Key: "games/2023/11/15/NA1_123/match.json",
      importedFromS3: true,
    });

    expect(await prisma.storedMatch.count()).toBe(1);
    expect(await prisma.matchParticipantFact.count()).toBe(1);

    const fact = await prisma.matchParticipantFact.findFirstOrThrow();
    expect(fact.serverId).toBe(serverId);
    expect(fact.matchId).toBe(match.metadata.matchId);
    expect(fact.puuid).toBe(LeaguePuuidSchema.parse(participant.puuid));
    expect(fact.championName).toBe(participant.championName);
    expect(fact.queue).toBe("arena");
  });

  test("stores raw prematch payloads and creates idempotent prematch participant facts", async () => {
    const puuid = testPuuid("prematch");
    await createTrackedPlayer({
      alias: "Prematch Player",
      puuid,
      discordId: testAccountId("102"),
    });

    const gameInfo = RawCurrentGameInfoSchema.parse({
      gameId: 9_000_000_001,
      gameStartTime: Date.UTC(2026, 4, 17, 18, 0, 0),
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
          riotId: "Prematch#NA1",
          spell1Id: 4,
          spell2Id: 7,
          lastSelectedSkinIndex: 1,
          bot: false,
          profileIconId: 10,
        },
      ],
    });
    const observedAt = new Date(Date.UTC(2026, 4, 17));

    await upsertStoredPrematchWithFacts(prisma, gameInfo, observedAt, {
      s3Key: "prematch/2026/05/17/9000000001/spectator-data.json",
      importedFromS3: true,
    });
    await upsertStoredPrematchWithFacts(prisma, gameInfo, observedAt, {
      s3Key: "prematch/2026/05/17/9000000001/spectator-data.json",
      importedFromS3: true,
    });

    expect(await prisma.storedPrematch.count()).toBe(1);
    expect(await prisma.prematchParticipantFact.count()).toBe(1);

    const fact = await prisma.prematchParticipantFact.findFirstOrThrow();
    expect(fact.serverId).toBe(serverId);
    expect(fact.puuid).toBe(puuid);
    expect(fact.queue).toBe("solo");
    expect(fact.riotId).toBe("Prematch#NA1");
  });

  test("answers Common Denominator surrender leaders from SQLite facts only", async () => {
    const match = await loadMatchFixture();
    const participant = match.info.participants[0];
    expect(participant).toBeDefined();
    if (participant === undefined) {
      throw new Error("fixture has no participants");
    }

    await createTrackedPlayer({
      alias: "Surrender Player",
      puuid: LeaguePuuidSchema.parse(participant.puuid),
      discordId: testAccountId("103"),
    });
    await upsertStoredMatchWithFacts(prisma, match);

    await prisma.matchParticipantFact.updateMany({
      where: { puuid: LeaguePuuidSchema.parse(participant.puuid) },
      data: { surrendered: true },
    });

    const rows = await getSurrenderLeadersFromSqlite({
      prisma,
      serverId,
      startDate: new Date(match.info.gameCreation - 1),
      endDate: new Date(match.info.gameEndTimestamp + 1),
      queues: ["arena"],
      minGames: 1,
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerAlias).toBe("Surrender Player");
    expect(rows[0]?.surrenders).toBe(1);
    expect(rows[0]?.surrenderRate).toBe(1);
  });

  test("answers a most-games-played competition leaderboard from SQLite facts only", async () => {
    const match = await loadMatchFixture();
    const participant = match.info.participants[0];
    expect(participant).toBeDefined();
    if (participant === undefined) {
      throw new Error("fixture has no participants");
    }

    const player = await createTrackedPlayer({
      alias: "Competition Player",
      puuid: LeaguePuuidSchema.parse(participant.puuid),
      discordId: testAccountId("104"),
    });
    await upsertStoredMatchWithFacts(prisma, match);

    const competition = await prisma.competition.create({
      data: {
        serverId,
        ownerId: testAccountId("105"),
        title: "SQLite Proof",
        description: "SQLite-backed proof competition",
        channelId: testChannelId("106"),
        isCancelled: false,
        visibility: "SERVER_WIDE",
        criteriaType: "MOST_GAMES_PLAYED",
        criteriaConfig: JSON.stringify({ queue: "ARENA" }),
        maxParticipants: 50,
        startDate: new Date(match.info.gameCreation - 1),
        endDate: new Date(match.info.gameEndTimestamp + 1),
        creatorDiscordId,
        createdTime: new Date(),
        updatedTime: new Date(),
      },
    });
    await prisma.competitionParticipant.create({
      data: {
        competitionId: competition.id,
        playerId: player.id,
        status: "JOINED",
        joinedAt: new Date(),
      },
    });

    const rows = await getMostGamesPlayedCompetitionLeaderboardFromSqlite(
      prisma,
      competition.id,
    );

    expect(rows).toEqual([
      {
        rank: 1,
        playerId: player.id,
        playerName: "Competition Player",
        discordId: testAccountId("104"),
        score: 1,
      },
    ]);
  });
});
