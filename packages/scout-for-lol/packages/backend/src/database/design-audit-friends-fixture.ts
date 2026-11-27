import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  LeaguePuuidSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type Region,
} from "@scout-for-lol/data";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * Friends and a streak for the redesigned Player and Players pages: tracked
 * players the main audit player queues with, ranks for each, and twenty recent
 * ranked games (12 won, a 3-game win streak) played in standard 5v5s with those
 * friends. Dated from `now` rather than a fixed day, because plays-with counts
 * only the last 90 days; the seed runs at every boot of the audit lake.
 */

const HOUR_MS = 3_600_000;

/** Oldest first, as the design shows them. */
const RESULTS_OLDEST_FIRST = [
  "L",
  "W",
  "L",
  "W",
  "L",
  "W",
  "W",
  "L",
  "W",
  "L",
  "W",
  "W",
  "W",
  "L",
  "L",
  "W",
  "L",
  "W",
  "W",
  "W",
] as const;

const CHAMPIONS = [
  { id: 103, name: "Ahri" },
  { id: 103, name: "Ahri" },
  { id: 134, name: "Syndra" },
  { id: 103, name: "Ahri" },
  { id: 61, name: "Orianna" },
] as const;

export type Friend = {
  alias: string;
  gameName: string;
  puuid: LeaguePuuid;
  rank: { tier: string; division: number; lp: number };
  champion: { id: number; name: string };
  /** Newest-first game indexes this friend queues in with the main player. */
  together: number[];
};

export const FRIENDS: Friend[] = [
  {
    alias: "Marrow",
    gameName: "Marrow",
    puuid: LeaguePuuidSchema.parse("1".repeat(78)),
    rank: { tier: "platinum", division: 1, lp: 80 },
    champion: { id: 412, name: "Thresh" },
    together: [0, 2, 4, 6, 8, 10, 12, 14, 16],
  },
  {
    alias: "Vesper",
    gameName: "Vesper",
    puuid: LeaguePuuidSchema.parse("2".repeat(78)),
    rank: { tier: "platinum", division: 3, lp: 12 },
    champion: { id: 99, name: "Lux" },
    together: [1, 5, 9, 13, 17],
  },
  {
    alias: "Oakheart",
    gameName: "Oakheart",
    puuid: LeaguePuuidSchema.parse("3".repeat(78)),
    rank: { tier: "gold", division: 1, lp: 33 },
    champion: { id: 122, name: "Darius" },
    together: [3, 11, 19],
  },
  {
    alias: "Lanternfish",
    gameName: "Lanternfish",
    puuid: LeaguePuuidSchema.parse("4".repeat(78)),
    rank: { tier: "gold", division: 2, lp: 71 },
    champion: { id: 157, name: "Yasuo" },
    together: [],
  },
];

function matchId(index: number): RiotMatchId {
  return RiotMatchIdSchema.parse(`NA1_${(9_450_000_000 + index).toString()}`);
}

type Seeded = Map<string, number>;

async function seedFriendPlayers(input: SeedInput): Promise<Seeded> {
  const players: Seeded = new Map();
  for (const friend of FRIENDS) {
    const player = await input.prisma.player.create({
      data: {
        serverId: input.guildId,
        alias: friend.alias,
        creatorDiscordId: input.discordId,
        createdTime: input.now,
        updatedTime: input.now,
      },
    });
    players.set(friend.alias, player.id);
    await input.prisma.account.create({
      data: {
        alias: friend.alias,
        puuid: friend.puuid,
        region: input.region,
        playerId: player.id,
        serverId: input.guildId,
        riotGameName: friend.gameName,
        riotTagLine: "NA1",
        riotIdUpdatedAt: input.now,
        lastMatchTime: input.now,
        lastCheckedAt: input.now,
        creatorDiscordId: input.discordId,
        createdTime: input.now,
        updatedTime: input.now,
      },
    });
    await input.prisma.currentRankSnapshot.upsert({
      where: { puuid: friend.puuid },
      update: {},
      create: {
        puuid: friend.puuid,
        soloRank: JSON.stringify({ ...friend.rank, wins: 31, losses: 24 }),
        fetchedAt: input.now,
      },
    });
  }
  return players;
}

type SeedInput = {
  prisma: PrismaClient;
  guildId: DiscordGuildId;
  discordId: DiscordAccountId;
  region: Region;
  main: { playerId: number; playerAlias: string; puuid: LeaguePuuid };
  now: Date;
};

type Facts = {
  matchFacts: TestLakeMatchFact[];
  untrackedMatchFacts: TestLakeMatchFact[];
};

/** One standard 5v5: the main player and any friends on one team. */
function gameFacts(
  input: SeedInput,
  players: Seeded,
  index: number,
  win: boolean,
): Facts {
  const at = new Date(input.now.getTime() - (index * 6 + 2) * HOUR_MS);
  const id = matchId(index);
  const queue = index % 5 === 4 ? "flex" : "solo";
  const champion = CHAMPIONS[index % CHAMPIONS.length];
  if (champion === undefined) throw new Error("Missing audit champion");
  const present = FRIENDS.filter((friend) => friend.together.includes(index));
  const team: TestLakeMatchFact[] = [
    {
      playerId: input.main.playerId,
      playerAlias: input.main.playerAlias,
      matchId: id,
      puuid: input.main.puuid,
      queue,
      win,
      surrendered: false,
      kills: 4 + (index % 7),
      deaths: 2 + (index % 4),
      assists: 6 + (index % 9),
      championId: champion.id,
      championName: champion.name,
      teamPosition: "MIDDLE",
      gameCreationAt: at,
    },
    ...present.map((friend, slot): TestLakeMatchFact => ({
      playerId: players.get(friend.alias) ?? 0,
      playerAlias: friend.alias,
      matchId: id,
      puuid: friend.puuid,
      queue,
      win,
      surrendered: false,
      kills: 3 + slot,
      deaths: 4,
      assists: 8,
      championId: friend.champion.id,
      championName: friend.champion.name,
      gameCreationAt: at,
    })),
  ];
  const strangers = Array.from(
    { length: 10 - team.length },
    (_, seat): TestLakeMatchFact => {
      const ours = seat < 5 - team.length;
      return {
        playerId: 9500 + seat,
        playerAlias: `Teammate ${seat.toString()}`,
        matchId: id,
        puuid: LeaguePuuidSchema.parse(
          `${index.toString(36)}${seat.toString(36)}`.padEnd(78, "z"),
        ),
        queue,
        win: ours ? win : !win,
        surrendered: false,
        kills: 3,
        deaths: 3,
        assists: 3,
        teamId: ours ? 100 : 200,
        gameCreationAt: at,
      };
    },
  );
  return { matchFacts: team, untrackedMatchFacts: strangers };
}

/** Lanternfish plays on their own, away from the main player. */
function lanternfishFacts(
  input: SeedInput,
  players: Seeded,
): TestLakeMatchFact[] {
  const lanternfish = FRIENDS.find((friend) => friend.alias === "Lanternfish");
  const playerId = players.get("Lanternfish");
  if (lanternfish === undefined || playerId === undefined) {
    throw new Error("Lanternfish was not seeded");
  }
  return [true, false].map((win, index): TestLakeMatchFact => ({
    playerId,
    playerAlias: lanternfish.alias,
    matchId: matchId(100 + index),
    puuid: lanternfish.puuid,
    queue: "solo",
    win,
    surrendered: false,
    kills: 9,
    deaths: 5,
    assists: 4,
    championId: lanternfish.champion.id,
    championName: lanternfish.champion.name,
    gameCreationAt: new Date(input.now.getTime() - (30 + index * 20) * HOUR_MS),
  }));
}

export async function seedDesignAuditFriends(input: SeedInput): Promise<Facts> {
  const players = await seedFriendPlayers(input);
  const games = RESULTS_OLDEST_FIRST.toReversed().map((result, index) =>
    gameFacts(input, players, index, result === "W"),
  );
  return {
    matchFacts: [
      ...games.flatMap((game) => game.matchFacts),
      ...lanternfishFacts(input, players),
    ],
    untrackedMatchFacts: games.flatMap((game) => game.untrackedMatchFacts),
  };
}
