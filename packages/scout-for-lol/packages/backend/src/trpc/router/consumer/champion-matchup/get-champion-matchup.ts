import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordGuildId, Lane } from "@scout-for-lol/data";
import { getChampionDisplayName } from "@scout-for-lol/data";
import {
  readMatchupLake,
  type RecentGameStats,
} from "#src/trpc/router/consumer/champion-matchup/matchup-lake.ts";
import {
  MATCHUP_RECENT_GAMES,
  tallyMatchupGames,
  type MatchupRecentGame,
  type MatchupTally,
} from "#src/trpc/router/consumer/champion-matchup/matchup-tally.ts";
import { laneStanding } from "#src/reports/lanes/ahead-at-15.ts";
import { getChampionPagePeople } from "#src/trpc/router/consumer/consumer-champion-people.ts";
import { loadMatchLpDeltas } from "#src/trpc/router/consumer/match-lp-delta.ts";
import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";

export type ChampionMatchupInput = {
  championId: number;
  opponentChampionId: number;
  lane: Lane;
  guildIds?: DiscordGuildId[] | undefined;
};

type ChampionRef = { championId: number; name: string };

/**
 * The in-app Matchup page: how the viewer and their friends did with one
 * champion against another in a lane.
 *
 * `unavailable` while the published lake predates `lane_results`; the page
 * states that lane data is not available yet instead of a record.
 */
export type ChampionMatchup =
  | { status: "unavailable"; reason: "lane-data" }
  | {
      status: "available";
      champion: ChampionRef;
      opponent: ChampionRef;
      lane: Lane;
      /** The viewer's games, however many accounts they played them on. */
      you: MatchupTally;
      /** The other people in scope, one game per person and match. */
      friends: MatchupTally;
      /** The viewer's newest games in the matchup, newest first. */
      recent: MatchupRecentGame[];
    };

function championRef(championId: number): ChampionRef {
  return { championId, name: getChampionDisplayName(championId) };
}

function requireStats(
  stats: ReadonlyMap<RiotMatchId, RecentGameStats>,
  row: LaneResultReadRow,
): RecentGameStats {
  const found = stats.get(row.match_id);
  if (found === undefined) {
    throw new Error(`Champion matchup has no match row for ${row.match_id}`);
  }
  return found;
}

async function recentGame(
  row: LaneResultReadRow,
  stats: ReadonlyMap<RiotMatchId, RecentGameStats>,
): Promise<MatchupRecentGame> {
  const scoreline = requireStats(stats, row);
  const remake =
    scoreline.early_surrendered ||
    (scoreline.end_of_game_result !== null &&
      scoreline.end_of_game_result !== "GameComplete");
  const lp = await loadMatchLpDeltas({
    matchId: row.match_id,
    queueId: row.queue_id,
    remake,
    puuids: [scoreline.puuid],
  });
  return {
    matchId: row.match_id,
    win: row.win,
    playedAtMs: row.game_created_ms,
    kills: scoreline.kills,
    deaths: scoreline.deaths,
    assists: scoreline.assists,
    at15: laneStanding(row),
    lpDelta: lp.get(scoreline.puuid)?.delta ?? null,
  };
}

/**
 * Resolve the viewer's scope, then read the matchup on one lake slot. A guild
 * outside the viewer's scope is FORBIDDEN before the lake is touched.
 */
export async function getChampionMatchup(
  user: Parameters<typeof getChampionPagePeople>[0],
  input: ChampionMatchupInput,
): Promise<ChampionMatchup> {
  const { people } = await getChampionPagePeople(user, input.guildIds);
  const read = await readMatchupLake({ ...input, people });
  if (read.status === "unavailable") {
    return { status: "unavailable", reason: "lane-data" };
  }
  const viewerGames = read.games.filter((game) => game.isViewer);
  return {
    status: "available",
    champion: championRef(input.championId),
    opponent: championRef(input.opponentChampionId),
    lane: input.lane,
    you: tallyMatchupGames(viewerGames),
    friends: tallyMatchupGames(read.games.filter((game) => !game.isViewer)),
    recent: await Promise.all(
      viewerGames
        .slice(0, MATCHUP_RECENT_GAMES)
        .map(async (game) => await recentGame(game.row, read.recentStats)),
    ),
  };
}
