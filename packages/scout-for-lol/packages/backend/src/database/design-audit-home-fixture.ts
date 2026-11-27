import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import { FRIENDS } from "#src/database/design-audit-friends-fixture.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * The Home page's week, on top of the friends the Players pages already seed:
 * a six-game win streak (Oakheart), a pentakill (Lanternfish), rank changes
 * for a climbing ladder with a promotion (Marrow), a friend in a live game and
 * the viewer's active challenge. Dated from the seed run, like the friends.
 *
 * Kept in its own file so the Home block is separate from the other pages'
 * fixtures; `seedDesignAuditHome` is the one call the audit seed makes.
 */

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const HOME_MATCH_BASE = 9_460_000_000;
const LIVE_MATCH_ID = RiotMatchIdSchema.parse("NA1_9460009999");
const CHALLENGE_TEMPLATE_ID = "6f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const CHALLENGE_RUN_ID = "7a2f3e4d-5c6b-4d7e-9f80-1b2c3d4e5f60";

function friend(alias: string) {
  const found = FRIENDS.find((candidate) => candidate.alias === alias);
  if (found === undefined) throw new Error(`Missing audit friend ${alias}`);
  return found;
}

function homeMatchId(index: number): RiotMatchId {
  return RiotMatchIdSchema.parse(`NA1_${(HOME_MATCH_BASE + index).toString()}`);
}

function rank(tier: string, division: number, lp: number) {
  return JSON.stringify({ tier, division, lp, wins: 31, losses: 24 });
}

type HomeSeedInput = {
  prisma: PrismaClient;
  guildId: DiscordGuildId;
  discordId: DiscordAccountId;
  now: Date;
};

async function playerId(input: HomeSeedInput, alias: string): Promise<number> {
  const player = await input.prisma.player.findFirstOrThrow({
    where: { serverId: input.guildId, alias },
    select: { id: true },
  });
  return player.id;
}

async function homeLakeFacts(
  input: HomeSeedInput,
): Promise<TestLakeMatchFact[]> {
  const oakheart = friend("Oakheart");
  const lanternfish = friend("Lanternfish");
  const oakheartId = await playerId(input, "Oakheart");
  const lanternfishId = await playerId(input, "Lanternfish");
  const streak = [3, 4, 5, 6, 7, 8].map(
    (hoursAgo, index): TestLakeMatchFact => ({
      playerId: oakheartId,
      playerAlias: oakheart.alias,
      matchId: homeMatchId(index),
      puuid: oakheart.puuid,
      queue: "solo",
      win: true,
      surrendered: false,
      kills: 6 + index,
      deaths: 2,
      assists: 7,
      championId: oakheart.champion.id,
      championName: oakheart.champion.name,
      gameCreationAt: new Date(input.now.getTime() - hoursAgo * HOUR_MS),
    }),
  );
  const pentakill: TestLakeMatchFact = {
    playerId: lanternfishId,
    playerAlias: lanternfish.alias,
    matchId: homeMatchId(10),
    puuid: lanternfish.puuid,
    queue: "solo",
    win: true,
    surrendered: false,
    kills: 21,
    deaths: 6,
    assists: 8,
    championId: lanternfish.champion.id,
    championName: lanternfish.champion.name,
    largestMultiKill: 5,
    gameCreationAt: new Date(input.now.getTime() - 20 * HOUR_MS),
  };
  return [...streak, pentakill];
}

async function seedRankMoves(input: HomeSeedInput) {
  const marrow = friend("Marrow");
  const oakheart = friend("Oakheart");
  const vesper = friend("Vesper");
  const moves: {
    puuid: LeaguePuuid;
    hoursAgo: number;
    before: string | null;
    after: string;
  }[] = [
    // Marrow: promoted to Platinum I, +41.
    {
      puuid: marrow.puuid,
      hoursAgo: 26,
      before: rank("platinum", 2, 90),
      after: rank("platinum", 1, 31),
    },
    {
      puuid: oakheart.puuid,
      hoursAgo: 5,
      before: rank("gold", 1, 0),
      after: rank("gold", 1, 38),
    },
    {
      puuid: vesper.puuid,
      hoursAgo: 30,
      before: rank("platinum", 3, 24),
      after: rank("platinum", 3, 12),
    },
  ];
  await input.prisma.matchRankHistory.deleteMany({
    where: { puuid: { in: moves.map((move) => move.puuid) } },
  });
  // The viewer's own rank history belongs to the Player page and is left alone.
  for (const [index, move] of moves.entries()) {
    const at = new Date(input.now.getTime() - move.hoursAgo * HOUR_MS);
    await input.prisma.matchRankHistory.create({
      data: {
        matchId: homeMatchId(100 + index),
        puuid: move.puuid,
        queueType: "solo",
        rankBefore: move.before,
        rankAfter: move.after,
        matchGameEndAt: at,
        capturedAt: at,
      },
    });
  }
}

async function seedLiveGame(input: HomeSeedInput) {
  const vesper = friend("Vesper");
  const startedAt = new Date(input.now.getTime() - 6 * MINUTE_MS);
  await input.prisma.liveGameRoster.deleteMany();
  await input.prisma.liveGameRoster.create({
    data: {
      riotMatchId: LIVE_MATCH_ID,
      platform: "NA1",
      gameId: LIVE_MATCH_ID.replace("NA1_", ""),
      queueId: 420,
      gameMode: "CLASSIC",
      gameStartedAt: startedAt,
      detectedAt: startedAt,
      expiresAt: new Date(input.now.getTime() + 3 * HOUR_MS),
      trackedPuuids: [vesper.puuid],
      participants: [
        {
          puuid: vesper.puuid,
          riotId: `${vesper.gameName}#NA1`,
          teamId: 100,
          championId: 103,
          spell1Id: 4,
          spell2Id: 14,
          keystoneId: null,
          primaryTreeId: null,
          secondaryTreeId: null,
          lane: "middle",
          rank: null,
          isTracked: true,
        },
      ],
    },
  });
}

async function seedChallenge(input: HomeSeedInput) {
  await input.prisma.challengeRun.deleteMany({
    where: { ownerDiscordId: input.discordId },
  });
  await input.prisma.challengeTemplate.deleteMany({
    where: { id: CHALLENGE_TEMPLATE_ID },
  });
  await input.prisma.challengeTemplate.create({
    data: { id: CHALLENGE_TEMPLATE_ID, authorDiscordId: input.discordId },
  });
  const version = await input.prisma.challengeTemplateVersion.create({
    data: {
      templateId: CHALLENGE_TEMPLATE_ID,
      version: 1,
      title: "New champions",
      summary: "Win 3 games on a champion you haven't played this act.",
      contractJson: "{}",
      authorDiscordId: input.discordId,
    },
  });
  await input.prisma.challengeRun.create({
    data: {
      id: CHALLENGE_RUN_ID,
      ownerDiscordId: input.discordId,
      templateId: CHALLENGE_TEMPLATE_ID,
      templateVersionId: version.id,
      originalStartAt: new Date(input.now.getTime() - 3 * 24 * HOUR_MS),
      frozenContractJson: "{}",
    },
  });
  const snapshot = await input.prisma.challengeRunSnapshot.create({
    data: {
      runId: CHALLENGE_RUN_ID,
      revision: 1,
      progressJson: JSON.stringify({
        kind: "scalar",
        reducer: "count",
        current: 1,
        target: 3,
        completed: false,
      }),
      coverageJson: "{}",
    },
  });
  await input.prisma.challengeRun.update({
    where: { id: CHALLENGE_RUN_ID },
    data: { recomputing: false, currentSnapshotId: snapshot.id },
  });
}

/** Seed the Home page's Postgres rows and return its extra lake games. */
export async function seedDesignAuditHome(
  input: HomeSeedInput,
): Promise<TestLakeMatchFact[]> {
  await seedRankMoves(input);
  await seedLiveGame(input);
  await seedChallenge(input);
  return await homeLakeFacts(input);
}
