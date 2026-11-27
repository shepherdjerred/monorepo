import {
  isArenaQueueOrMode,
  type DiscordGuildId,
  type Rank,
  type RiotMatchId,
} from "@scout-for-lol/data";
import {
  ROSTER_FORM_GAMES,
  runOfSameResult,
} from "#src/lib/player-profile/roster.ts";
import type { RosterGameRow } from "#src/reports/duckdb/consumer/pages/roster-lake-reads.ts";
import type { HomePerson } from "#src/trpc/router/consumer/home/home-people.ts";
import type { RankMove } from "#src/trpc/router/consumer/home/home-ranks.ts";

export const HOME_FEED_DAYS = 7;
export const HOME_FEED_LINES = 50;
/** A win streak is a line of its own from this many games. */
export const HOME_STREAK_MIN_GAMES = 5;
const DAY_MS = 86_400_000;
const PENTAKILL = 5;

type Who = {
  playerId: number;
  alias: string;
  /** The viewer's servers the person is in; the page's server chips filter on it. */
  guildIds: DiscordGuildId[];
};

export type HomeFeedItem =
  | (Who & {
      kind: "game";
      at: number;
      matchId: RiotMatchId;
      win: boolean;
      championId: number;
      championName: string;
      queueId: number;
      kills: number;
      deaths: number;
      assists: number;
      /** The viewer was in this game, on the same side. */
      withYou: boolean;
    })
  | (Who & {
      kind: "pentakill";
      at: number;
      matchId: RiotMatchId;
      championId: number;
      championName: string;
    })
  | (Who & {
      kind: "streak";
      /** The time of the newest game in the streak. */
      at: number;
      games: number;
      atLeast: boolean;
    })
  | (Who & { kind: "rankUp"; at: number; queue: "solo" | "flex"; rank: Rank });

const KIND_ORDER: Record<HomeFeedItem["kind"], number> = {
  pentakill: 0,
  rankUp: 1,
  streak: 2,
  game: 3,
};

function sameSide(left: RosterGameRow, right: RosterGameRow): boolean {
  return isArenaQueueOrMode(left.queue_id, left.game_mode)
    ? left.player_subteam_id !== null &&
        left.player_subteam_id === right.player_subteam_id
    : left.team_id === right.team_id;
}

function gameLines(
  person: HomePerson,
  who: Who,
  sinceMs: number,
  viewerGames: ReadonlyMap<RiotMatchId, RosterGameRow>,
): HomeFeedItem[] {
  return person.games
    .filter((game) => game.game_creation_ms >= sinceMs)
    .map((game): HomeFeedItem => {
      const common = {
        ...who,
        at: game.game_creation_ms,
        matchId: game.match_id,
        championId: game.champion_id,
        championName: game.champion_name,
      };
      if (game.largest_multi_kill >= PENTAKILL) {
        return { kind: "pentakill", ...common };
      }
      const viewerGame = viewerGames.get(game.match_id);
      return {
        kind: "game",
        ...common,
        win: game.win,
        queueId: game.queue_id,
        kills: game.kills,
        deaths: game.deaths,
        assists: game.assists,
        withYou: viewerGame !== undefined && sameSide(game, viewerGame),
      };
    });
}

function streakLine(
  person: HomePerson,
  who: Who,
  sinceMs: number,
): HomeFeedItem[] {
  const newest = person.games[0];
  if (newest === undefined || newest.game_creation_ms < sinceMs) return [];
  const streak = runOfSameResult(person.games.slice(0, ROSTER_FORM_GAMES));
  return streak?.result === "win" && streak.games >= HOME_STREAK_MIN_GAMES
    ? [
        {
          kind: "streak",
          ...who,
          at: newest.game_creation_ms,
          games: streak.games,
          atLeast: streak.atLeast,
        },
      ]
    : [];
}

function rankUpLines(
  person: HomePerson,
  who: Who,
  moves: readonly RankMove[],
): HomeFeedItem[] {
  return moves.flatMap((move): HomeFeedItem[] =>
    move.promotedTo !== null && person.puuids.has(move.puuid)
      ? [
          {
            kind: "rankUp",
            ...who,
            at: move.at,
            queue: move.queue,
            rank: move.promotedTo,
          },
        ]
      : [],
  );
}

function matchOf(item: HomeFeedItem): string {
  return item.kind === "game" || item.kind === "pentakill" ? item.matchId : "";
}

/**
 * What the viewer's friends did in the last seven days, newest first and at
 * most fifty lines. The viewer's own games are not in it; they have the You
 * panel. Derived per request from the games already read for the page.
 */
export function buildHomeFeed(input: {
  people: readonly HomePerson[];
  moves: readonly RankMove[];
  nowMs: number;
}): HomeFeedItem[] {
  const sinceMs = input.nowMs - HOME_FEED_DAYS * DAY_MS;
  const viewer = input.people.find((person) => person.isYou);
  const viewerGames = new Map(
    (viewer?.games ?? []).map((game) => [game.match_id, game] as const),
  );
  const moves = input.moves.filter((move) => move.at >= sinceMs);
  return input.people
    .filter((person) => !person.isYou)
    .flatMap((person) => {
      const who = {
        playerId: person.playerId,
        alias: person.alias,
        guildIds: person.guildIds,
      };
      return [
        ...gameLines(person, who, sinceMs, viewerGames),
        ...streakLine(person, who, sinceMs),
        ...rankUpLines(person, who, moves),
      ];
    })
    .toSorted(
      (left, right) =>
        right.at - left.at ||
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        left.playerId - right.playerId ||
        matchOf(left).localeCompare(matchOf(right)),
    )
    .slice(0, HOME_FEED_LINES);
}
