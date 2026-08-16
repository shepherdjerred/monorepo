import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

// Offline tRPC harness: real router, no Discord OAuth. See
// src/testing/test-trpc-caller.ts. Must be created before appRouter is imported.
const trpc = await createOfflineTrpcHarness("trpc-player-profile-test");
const { prisma: testPrisma } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000021");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000022");
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000021");
const lakeDir = resolveLakeDir();

const MAIN = testPuuid("router-main");
const SMURF = testPuuid("router-smurf");
const gameCreatedAt = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));

async function seedPlayer(options: {
  serverId: DiscordGuildId;
  alias: string;
  puuids: LeaguePuuid[];
}) {
  const now = new Date();
  const player = await testPrisma.player.create({
    data: {
      alias: options.alias,
      serverId: options.serverId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
  for (const [index, puuid] of options.puuids.entries()) {
    await testPrisma.account.create({
      data: {
        alias: `${options.alias}-${index.toString()}`,
        puuid,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: options.serverId,
        creatorDiscordId: actorDiscordId,
        riotGameName: `${options.alias}${index.toString()}`,
        riotTagLine: "NA1",
        createdTime: now,
        updatedTime: now,
      },
    });
  }
  return player;
}

function matchFact(options: {
  matchId: string;
  puuid: string;
  kills: number;
  teamId: number;
  win: boolean;
  playerId: number;
}) {
  return {
    playerId: options.playerId,
    playerAlias: "Router Player",
    matchId: options.matchId,
    puuid: options.puuid,
    queue: "solo",
    win: options.win,
    surrendered: false,
    kills: options.kills,
    deaths: 2,
    assists: 3,
    teamId: options.teamId,
    gameCreationAt: gameCreatedAt,
  };
}

beforeEach(async () => {
  await testPrisma.matchRankHistory.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.player.deleteMany();
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("player.profileSummary", () => {
  test("aggregates every account of one player into one profile", async () => {
    await seedPlayer({
      serverId: guildId,
      alias: "Smurfer",
      puuids: [MAIN, SMURF],
    });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        matchFact({
          matchId: "NA1_a",
          puuid: MAIN,
          kills: 5,
          teamId: 100,
          win: true,
          playerId: 1,
        }),
        matchFact({
          matchId: "NA1_b",
          puuid: SMURF,
          kills: 4,
          teamId: 100,
          win: false,
          playerId: 1,
        }),
      ],
    });

    const summary = await trpc
      .authedCaller()
      .player.profileSummary({ guildId, alias: "Smurfer" });

    expect(summary.accountCount).toBe(2);
    expect(summary.recentForm?.games).toBe(2);
    expect(summary.recentForm?.wins).toBe(1);
    // One champion, played on both accounts.
    expect(summary.championPool).toHaveLength(1);
    expect(summary.championPool[0]?.games).toBe(2);
    // Two games is far below the rate threshold and must say so.
    expect(summary.championPool[0]?.lowSample).toBe(true);
    expect(summary.minGamesForRate).toBe(10);
  });

  test("refuses a player belonging to another guild", async () => {
    await seedPlayer({
      serverId: otherGuildId,
      alias: "Stranger",
      puuids: [MAIN],
    });

    // Alias lookup is keyed by (serverId, alias); a guild must not reach
    // another server's player, which is what keeps its puuids — and therefore
    // its whole match history — out of this guild's reads.
    await expect(
      trpc.authedCaller().player.profileSummary({ guildId, alias: "Stranger" }),
    ).rejects.toThrow(/not found/i);
  });

  test("rejects an anonymous caller", async () => {
    await seedPlayer({ serverId: guildId, alias: "Solo", puuids: [MAIN] });

    await expect(
      trpc.anonCaller().player.profileSummary({ guildId, alias: "Solo" }),
    ).rejects.toThrow();
  });
});

describe("player.matchHistory", () => {
  test("computes kill participation against the whole team", async () => {
    await seedPlayer({ serverId: guildId, alias: "Solo", puuids: [MAIN] });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        matchFact({
          matchId: "NA1_team",
          puuid: MAIN,
          kills: 5,
          teamId: 100,
          win: true,
          playerId: 1,
        }),
      ],
      // Teammates Scout has match rows for but this guild does not track.
      untrackedMatchFacts: [
        matchFact({
          matchId: "NA1_team",
          puuid: testPuuid("router-ally"),
          kills: 5,
          teamId: 100,
          win: true,
          playerId: 91,
        }),
        matchFact({
          matchId: "NA1_team",
          puuid: testPuuid("router-enemy"),
          kills: 7,
          teamId: 200,
          win: false,
          playerId: 92,
        }),
      ],
    });

    const history = await trpc
      .authedCaller()
      .player.matchHistory({ guildId, alias: "Solo", limit: 20 });

    const entry = history.entries[0];
    if (entry === undefined) throw new Error("expected one entry");
    // 5 kills + 3 assists over a team total of 10 kills. A puuid-scoped team
    // query would make this 1.0.
    expect(entry.killParticipation).toBeCloseTo(0.8, 5);
    expect(history.nextCursor).toBeNull();
  });

  test("reports the LP change for a game", async () => {
    await seedPlayer({ serverId: guildId, alias: "Solo", puuids: [MAIN] });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        matchFact({
          matchId: "NA1_lp",
          puuid: MAIN,
          kills: 5,
          teamId: 100,
          win: true,
          playerId: 1,
        }),
      ],
    });
    await testPrisma.matchRankHistory.create({
      data: {
        matchId: "NA1_lp",
        puuid: MAIN,
        queueType: "solo",
        rankBefore: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 40,
          wins: 10,
          losses: 5,
        }),
        rankAfter: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 62,
          wins: 11,
          losses: 5,
        }),
        capturedAt: new Date(),
      },
    });

    const history = await trpc
      .authedCaller()
      .player.matchHistory({ guildId, alias: "Solo", limit: 20 });

    expect(history.entries[0]?.leaguePointsDelta).toBe(22);
  });

  test("leaves LP null when the game has no rank snapshot", async () => {
    await seedPlayer({ serverId: guildId, alias: "Solo", puuids: [MAIN] });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        matchFact({
          matchId: "NA1_norank",
          puuid: MAIN,
          kills: 5,
          teamId: 100,
          win: true,
          playerId: 1,
        }),
      ],
    });

    const history = await trpc
      .authedCaller()
      .player.matchHistory({ guildId, alias: "Solo", limit: 20 });

    expect(history.entries[0]?.leaguePointsDelta).toBeNull();
  });

  test("returns a cursor only when another page exists", async () => {
    await seedPlayer({ serverId: guildId, alias: "Solo", puuids: [MAIN] });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [0, 1, 2].map((index) => ({
        ...matchFact({
          matchId: `NA1_${index.toString()}`,
          puuid: MAIN,
          kills: 5,
          teamId: 100,
          win: true,
          playerId: 1,
        }),
        gameCreationAt: new Date(gameCreatedAt.getTime() + index * 60_000),
      })),
    });

    const firstPage = await trpc
      .authedCaller()
      .player.matchHistory({ guildId, alias: "Solo", limit: 2 });
    expect(firstPage.entries).toHaveLength(2);
    const cursor = firstPage.nextCursor;
    if (cursor === null) throw new Error("expected a next cursor");

    const secondPage = await trpc
      .authedCaller()
      .player.matchHistory({ guildId, alias: "Solo", limit: 2, cursor });
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
  });
});
