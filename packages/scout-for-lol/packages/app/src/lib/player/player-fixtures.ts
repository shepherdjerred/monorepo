import {
  DiscordGuildIdSchema,
  PlayerIdSchema,
  RiotMatchIdSchema,
  rankToChartPoints,
} from "@scout-for-lol/data";
import type { HistoryEntry, RankHistory } from "#src/lib/player/player-feed.ts";
import type { PlayerSummary } from "#src/lib/player/player-page.ts";

/** Fixture builders for the Player page's tests and stories. */

export const RIFT_STUDY_GROUP = DiscordGuildIdSchema.parse(
  "1337623164146155593",
);
export const PLAYER_ID = PlayerIdSchema.parse(7);

/** The newest game's time in the fixtures: 2026-11-27 10:00 UTC. */
export const NOW_MS = Date.UTC(2026, 10, 27, 12, 0, 0);

export function matchId(n: number) {
  return RiotMatchIdSchema.parse(`NA1_${(9_200_000_000 + n).toString()}`);
}

/** A player with games: the no-account summary has no behavior at all. */
export type PopulatedSummary = Extract<PlayerSummary, { behavior: object }>;
type Pool = PlayerSummary["championPool"][number];

export function poolEntry(overrides: Partial<Pool> = {}): Pool {
  return {
    championId: 103,
    championName: "Ahri",
    games: 8,
    wins: 6,
    losses: 2,
    winRate: 0.75,
    kda: 4,
    averageKills: 6,
    averageDeaths: 3,
    averageAssists: 8,
    averageCs: 180,
    csPerMinute: 7,
    damagePerMinute: 700,
    averageDamage: 24_000,
    averageVisionScore: 20,
    teamPosition: "MIDDLE",
    lowSample: false,
    ...overrides,
  };
}

export function playerSummary(
  overrides: Partial<PopulatedSummary> = {},
): PopulatedSummary {
  return {
    alias: "Northstar",
    accountCount: 1,
    accounts: [
      {
        gameName: "Northstar",
        tagLine: "NA1",
        region: "AMERICA_NORTH",
        riotIdUpdatedAt: null,
        lastMatchTime: null,
        lastCheckedAt: null,
        ranks: {},
        mastery: null,
      },
    ],
    riotIds: [{ gameName: "Northstar", tagLine: "NA1" }],
    ranks: {
      solo: { tier: "emerald", division: 2, lp: 64, wins: 47, losses: 32 },
      flex: { tier: "platinum", division: 1, lp: 12, wins: 10, losses: 9 },
    },
    recentForm: {
      games: 20,
      wins: 12,
      kills: 140,
      deaths: 80,
      assists: 200,
      averageKillParticipation: 0.6,
      averageCs: 180,
      averageCsPerMinute: 7,
      averageVisionScore: 20,
      preferredPositions: [{ position: "MIDDLE", games: 16, percentage: 80 }],
    },
    behavior: {
      roleShare: [],
      activityTimes: [],
      streak: { result: "win", games: 3, atLeast: false },
      recent20: { games: 20, wins: 12, kda: 3.42, csPerMinute: 7 },
      currentAct: null,
    },
    championPool: [
      poolEntry(),
      poolEntry({
        championId: 134,
        championName: "Syndra",
        games: 4,
        wins: 2,
        losses: 2,
        winRate: 0.5,
      }),
      poolEntry({
        championId: 61,
        championName: "Orianna",
        games: 3,
        wins: 2,
        losses: 1,
        winRate: 2 / 3,
        lowSample: true,
      }),
    ],
    minGamesForRate: 5,
    highlights: {
      streak: { result: "win", games: 3, atLeast: false },
      lately: {
        games: 20,
        wins: 12,
        results: Array.from({ length: 20 }, (_, index) => ({
          matchId: matchId(index),
          // Newest first: three wins, then a loss, then alternating.
          win: index < 3 || index % 2 === 0,
        })),
      },
      bestChampion: {
        championId: 103,
        championName: "Ahri",
        games: 8,
        wins: 6,
        winRate: 0.75,
        lowSample: false,
      },
      latestGame: null,
    },
    championForm: [],
    playsWith: { windowDays: 90, friends: [] },
    guild: { id: RIFT_STUDY_GROUP, name: "Rift Study Group", icon: null },
    ...overrides,
  };
}

export function historyEntry(
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    matchId: matchId(1),
    gameCreationMs: NOW_MS - 2 * 3_600_000,
    gameDurationSeconds: 1800,
    queue: "solo",
    queueId: 420,
    gameMode: "CLASSIC",
    placement: null,
    augments: [],
    roster: [],
    championId: 103,
    championName: "Ahri",
    teamPosition: "MIDDLE",
    win: true,
    kills: 9,
    deaths: 2,
    assists: 11,
    creepScore: 200,
    largestMultiKill: 1,
    csPerMinute: 7,
    visionScore: 20,
    goldEarned: 12_000,
    killParticipation: 0.6,
    damageShare: 0.3,
    leaguePointsDelta: 21,
    loadout: { itemIds: [], summonerSpellIds: [4, 14], runes: null },
    account: { gameName: "Northstar", tagLine: "NA1", region: "AMERICA_NORTH" },
    ...overrides,
  };
}

export function rankPoint(
  tier: "platinum" | "emerald",
  division: 1 | 2 | 3 | 4,
  lp: number,
  at: string,
) {
  const rank = { tier, division, lp, wins: 0, losses: 0 };
  return {
    at,
    leaguePoints: rankToChartPoints(rank),
    rank,
  } satisfies RankHistory["queues"]["solo"]["series"][number]["points"][number];
}
