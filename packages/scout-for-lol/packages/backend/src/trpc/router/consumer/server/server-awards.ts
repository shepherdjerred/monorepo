import type { DiscordAccountId } from "@scout-for-lol/data";
import type { GuildMatchRow } from "#src/reports/duckdb/community/community-lake.ts";
import {
  byName,
  playerRef,
  type ServerPlayer,
} from "#src/trpc/router/consumer/server/server-people.ts";

/** A win streak this short is not an award. */
export const MIN_STREAK_WINS = 3;
/** The play of the week is a quadrakill or better. */
export const MIN_PLAY_MULTI_KILL = 4;

type Game = { row: GuildMatchRow; player: ServerPlayer };

/** Each player's games since `sinceMs`, oldest first, a match counted once. */
function gamesByPlayer(
  players: ServerPlayer[],
  rows: GuildMatchRow[],
  sinceMs: number,
): Map<number, Game[]> {
  const ownerByPuuid = new Map<string, ServerPlayer>(
    players.flatMap((player) =>
      player.accounts.map((account) => [account.puuid, player] as const),
    ),
  );
  const seen = new Map<number, Map<string, Game>>();
  for (const row of rows) {
    if (row.puuid === null || row.game_creation_ms < sinceMs) continue;
    const player = ownerByPuuid.get(row.puuid);
    if (player === undefined) continue;
    const games = seen.get(player.id) ?? new Map<string, Game>();
    // One person on two accounts in one match is one game.
    if (!games.has(row.match_id)) games.set(row.match_id, { row, player });
    seen.set(player.id, games);
  }
  return new Map(
    [...seen].map(([playerId, games]) => [
      playerId,
      [...games.values()].toSorted(
        (left, right) =>
          left.row.game_creation_ms - right.row.game_creation_ms ||
          left.row.match_id.localeCompare(right.row.match_id),
      ),
    ]),
  );
}

function longestWinRun(games: Game[]): number {
  let best = 0;
  let current = 0;
  for (const game of games) {
    current = game.row.win ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

/**
 * The week's superlatives from one guild scan and the week's LP movement.
 * Each award is `null` when nobody earned it. `climbs` maps a player id to the
 * Solo/Duo LP gained over the week.
 */
export function buildAwards(input: {
  players: ServerPlayer[];
  rows: GuildMatchRow[];
  climbs: Map<number, number>;
  sinceMs: number;
  viewerDiscordId: DiscordAccountId;
}) {
  const ref = (player: ServerPlayer) =>
    playerRef(player, input.viewerDiscordId);
  const games = gamesByPlayer(input.players, input.rows, input.sinceMs);

  const climbers = input.players
    .map((player) => ({ player, lp: input.climbs.get(player.id) ?? 0 }))
    .filter((entry) => entry.lp > 0)
    .toSorted(
      (left, right) => right.lp - left.lp || byName(left.player, right.player),
    )[0];

  const busiest = input.players
    .map((player) => ({ player, games: games.get(player.id)?.length ?? 0 }))
    .filter((entry) => entry.games > 0)
    .toSorted(
      (left, right) =>
        right.games - left.games || byName(left.player, right.player),
    )[0];

  const streaks = input.players
    .map((player) => ({
      player,
      wins: longestWinRun(games.get(player.id) ?? []),
    }))
    .filter((entry) => entry.wins >= MIN_STREAK_WINS)
    .toSorted(
      (left, right) =>
        right.wins - left.wins || byName(left.player, right.player),
    )[0];

  const play = [...games.values()]
    .flat()
    .filter((game) => game.row.largest_multi_kill >= MIN_PLAY_MULTI_KILL)
    .toSorted(
      (left, right) =>
        right.row.largest_multi_kill - left.row.largest_multi_kill ||
        right.row.game_creation_ms - left.row.game_creation_ms ||
        right.row.match_id.localeCompare(left.row.match_id) ||
        byName(left.player, right.player),
    )[0];

  return {
    biggestClimb:
      climbers === undefined
        ? null
        : { player: ref(climbers.player), lp: climbers.lp },
    mostGames:
      busiest === undefined
        ? null
        : { player: ref(busiest.player), games: busiest.games },
    longestStreak:
      streaks === undefined
        ? null
        : { player: ref(streaks.player), wins: streaks.wins },
    playOfTheWeek:
      play === undefined
        ? null
        : {
            player: ref(play.player),
            matchId: play.row.match_id,
            championId: play.row.champion_id,
            championName: play.row.champion_name,
            multiKill: play.row.largest_multi_kill,
          },
  };
}
