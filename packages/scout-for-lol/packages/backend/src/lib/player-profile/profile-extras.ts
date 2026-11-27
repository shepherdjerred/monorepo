import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { PlayerStreak } from "#src/lib/player-profile/behavior.ts";
import type { GuildMatchRow } from "#src/reports/duckdb/community/community-lake.ts";
import type { LakeChampionRecentFormRow } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildCommunityInsights,
  type CommunityPlayer,
} from "#src/trpc/router/consumer/community-insights.ts";

/**
 * What the redesigned Player page reads beyond the combined profile: a
 * "Lately" summary, the friends the player queues with, and how each top
 * champion has gone lately. Pure builders over rows the profile page already
 * read on its one lake slot.
 */

/** Results shown in the "Lately" strip. */
export const LATELY_GAMES = 20;
/** Friends listed, and the fewest shared games that make someone one. */
export const PLAYS_WITH_LIMIT = 5;
export const MIN_GAMES_TOGETHER = 3;
/** How far back shared games are counted. Carried on the payload. */
export const PLAYS_WITH_WINDOW_DAYS = 90;
/** Top champions given a form line, and games on each. */
export const CHAMPION_FORM_CHAMPIONS = 5;
export const CHAMPION_FORM_GAMES = 10;

type RecentGame = {
  matchId: RiotMatchId;
  win: boolean;
  championId: number;
  championName: string;
  teamPosition: string;
  kills: number;
  deaths: number;
  assists: number;
  largestMultiKill: number;
  queue: string | null;
  queueId: number;
  gameCreationMs: number;
  gameDurationSeconds: number;
  placement: number | null;
  leaguePointsDelta: number | null;
};

type RankedChampion = {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  winRate: number;
  lowSample: boolean;
};

/**
 * Current streak, the last results newest first, the best champion over the
 * profile's window, and the latest game as plain fields for a sentence.
 *
 * "Best" is by win rate among champions with enough games for a rate to mean
 * something, then by games; with none that qualify, the same order over the
 * rest, and the champion carries `lowSample`.
 */
export function buildHighlights(input: {
  recent: readonly RecentGame[];
  streak: PlayerStreak | null;
  pool: readonly RankedChampion[];
}) {
  const lately = input.recent.slice(0, LATELY_GAMES);
  const best = input.pool.toSorted(
    (left, right) =>
      Number(left.lowSample) - Number(right.lowSample) ||
      right.winRate - left.winRate ||
      right.games - left.games ||
      left.championName.localeCompare(right.championName) ||
      left.championId - right.championId,
  )[0];
  const latest = input.recent[0];
  return {
    streak: input.streak,
    lately:
      lately.length === 0
        ? null
        : {
            games: lately.length,
            wins: lately.filter((game) => game.win).length,
            results: lately.map((game) => ({
              matchId: game.matchId,
              win: game.win,
            })),
          },
    bestChampion:
      best === undefined
        ? null
        : {
            championId: best.championId,
            championName: best.championName,
            games: best.games,
            wins: best.wins,
            winRate: best.winRate,
            lowSample: best.lowSample,
          },
    latestGame:
      latest === undefined
        ? null
        : {
            matchId: latest.matchId,
            win: latest.win,
            championId: latest.championId,
            championName: latest.championName,
            teamPosition: latest.teamPosition,
            kills: latest.kills,
            deaths: latest.deaths,
            assists: latest.assists,
            largestMultiKill: latest.largestMultiKill,
            queue: latest.queue,
            queueId: latest.queueId,
            gameCreationMs: latest.gameCreationMs,
            gameDurationSeconds: latest.gameDurationSeconds,
            placement: latest.placement,
            leaguePointsDelta: latest.leaguePointsDelta,
          },
  };
}

/**
 * The last `CHAMPION_FORM_GAMES` games on each of the player's top champions,
 * newest first. Every entry carries its own game count.
 */
export function buildChampionForm(
  pool: readonly { championId: number; championName: string }[],
  rows: readonly LakeChampionRecentFormRow[],
) {
  return pool.slice(0, CHAMPION_FORM_CHAMPIONS).map((champion) => {
    const results = rows
      .filter((row) => row.champion_id === champion.championId)
      .map((row) => row.win);
    return {
      championId: champion.championId,
      championName: champion.championName,
      games: results.length,
      wins: results.filter(Boolean).length,
      results: results.map((win) => (win ? "win" : "loss")),
    };
  });
}

/**
 * The tracked players this player shares a team with most, from
 * `buildCommunityInsights` over their own games. Players of the same server
 * only: an untracked teammate is not a friend.
 */
export function buildPlaysWith(input: {
  subject: CommunityPlayer;
  players: CommunityPlayer[];
  rows: GuildMatchRow[];
}) {
  const insights = buildCommunityInsights({
    players: input.players,
    rows: input.rows,
    allTimeAccounts: [],
    standardOnly: true,
  });
  const friends = insights.recentlyPlayedWith
    .filter(
      (relation) =>
        relation.playerId === input.subject.id &&
        relation.guildPlayerId !== null &&
        relation.games >= MIN_GAMES_TOGETHER,
    )
    .toSorted(
      (left, right) =>
        right.games - left.games ||
        right.wins - left.wins ||
        right.lastMatchMs - left.lastMatchMs ||
        left.name.localeCompare(right.name) ||
        (left.guildPlayerId ?? 0) - (right.guildPlayerId ?? 0),
    )
    .slice(0, PLAYS_WITH_LIMIT);
  return {
    windowDays: PLAYS_WITH_WINDOW_DAYS,
    friends: friends.map((friend) => {
      if (friend.guildPlayerId === null) {
        throw new Error("A friend relation lost its guild player");
      }
      return {
        playerId: friend.guildPlayerId,
        alias: friend.name,
        games: friend.games,
        wins: friend.wins,
        lastGameMs: friend.lastMatchMs,
      };
    }),
  };
}
