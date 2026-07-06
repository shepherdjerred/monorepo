import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  LeaguePuuidSchema,
  RawMatchSchema,
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
} from "#src/testing/test-ids.ts";
import { createCompetition } from "#src/database/competition/queries.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { runReportLakeRebuild } from "#src/report-lake/compactor.ts";
import { resetTestLake } from "#src/testing/test-report-lake.ts";
import { upsertStoredMatchWithFacts } from "#src/report-store/store.ts";
import {
  getMostGamesPlayedCompetitionLeaderboardFromSqlite,
  getSurrenderLeadersFromSqlite,
} from "#src/report-store/queries.ts";
import {
  getMostGamesPlayedCompetitionLeaderboardFromLake,
  getSurrenderLeadersFromLake,
} from "#src/report-lake/queries.ts";

/**
 * Parity: the lake ports of the report-store proof queries must return
 * exactly what the fact-table originals return on identically-seeded data
 * (real ingest path + full lake rebuild). The originals die with the fact
 * tables in the follow-up PR; until then this suite is the contract.
 */

const { prisma } = createTestDatabase("report-lake-queries-test");
const serverId = testGuildId("949494");
const now = new Date(Date.UTC(2025, 9, 15, 12, 0, 0));
const lakeDir = resolveLakeDir();

let competitionId = 0;

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

async function createTrackedPlayer(alias: string, puuid: LeaguePuuid) {
  const timestamp = new Date();
  const player = await prisma.player.create({
    data: {
      alias,
      discordId: testAccountId(`94${(alias.codePointAt(0) ?? 0).toString()}`),
      serverId,
      creatorDiscordId: testAccountId("949494"),
      createdTime: timestamp,
      updatedTime: timestamp,
    },
  });
  await prisma.account.create({
    data: {
      alias,
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId: testAccountId("949494"),
      createdTime: timestamp,
      updatedTime: timestamp,
    },
  });
  return player;
}

beforeAll(async () => {
  await resetTestLake(lakeDir);
  const fixture = await loadMatchFixture();
  const first = fixture.info.participants[0];
  const second = fixture.info.participants[1];
  if (first === undefined || second === undefined) {
    throw new Error("fixture lacks participants");
  }
  const alpha = await createTrackedPlayer(
    "QAlpha",
    LeaguePuuidSchema.parse(first.puuid),
  );
  await createTrackedPlayer("QBravo", LeaguePuuidSchema.parse(second.puuid));

  const day = 24 * 60 * 60 * 1000;
  for (const [index, offsetDays] of [2, 5, 9].entries()) {
    const clone = structuredClone(fixture);
    clone.metadata.matchId = `NA1_lakeq_${index.toString()}`;
    clone.info.gameCreation = now.getTime() - offsetDays * day;
    clone.info.gameStartTimestamp = clone.info.gameCreation;
    clone.info.gameEndTimestamp =
      clone.info.gameCreation + clone.info.gameDuration * 1000;
    clone.info.queueId = 420;
    await upsertStoredMatchWithFacts(prisma, clone);
  }

  const competition = await createCompetition(prisma, {
    serverId,
    ownerId: testAccountId("949494"),
    channelId: testChannelId("949495"),
    title: "Most Games",
    description: "lake parity",
    visibility: "OPEN",
    maxParticipants: 10,
    dates: {
      type: "FIXED_DATES",
      startDate: new Date(now.getTime() - 30 * day),
      endDate: new Date(now.getTime() + day),
    },
    criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
  });
  competitionId = competition.id;
  await prisma.competitionParticipant.create({
    data: {
      competitionId: competition.id,
      playerId: alpha.id,
      status: "JOINED",
      joinedAt: new Date(now.getTime() - 30 * day),
    },
  });

  const summary = await runReportLakeRebuild({ prisma, lakeDir });
  if (summary === null || summary.skippedMatches > 0) {
    throw new Error("lake rebuild failed");
  }
});

afterAll(async () => {
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedMatch.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
  await prisma.$disconnect();
});

describe("report-lake query ports", () => {
  test("surrender leaders match the fact-table original", async () => {
    const params = {
      serverId,
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      endDate: now,
      minGames: 1,
      limit: 10,
    };
    const legacy = await getSurrenderLeadersFromSqlite({ prisma, ...params });
    const lake = await getSurrenderLeadersFromLake(params);
    expect(lake).toEqual(legacy);
  });

  test("surrender leaders with queue filter match", async () => {
    const params = {
      serverId,
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      endDate: now,
      queues: ["solo"],
      minGames: 2,
      limit: 5,
    };
    const legacy = await getSurrenderLeadersFromSqlite({ prisma, ...params });
    const lake = await getSurrenderLeadersFromLake(params);
    expect(lake).toEqual(legacy);
  });

  test("most-games competition leaderboard matches the fact-table original", async () => {
    const legacy = await getMostGamesPlayedCompetitionLeaderboardFromSqlite(
      prisma,
      competitionId,
    );
    const lake = await getMostGamesPlayedCompetitionLeaderboardFromLake(
      prisma,
      competitionId,
    );
    expect(lake).toEqual(legacy);
  });
});
