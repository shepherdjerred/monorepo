import { z } from "zod";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { Lane } from "@scout-for-lol/data";
import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";
import {
  withLakePage,
  type LakePage,
} from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { readLaneResultsOnPage } from "#src/reports/duckdb/consumer/pages/lane-results-page-reads.ts";
import { runSource } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";
import {
  attributeMatchupGames,
  MATCHUP_RECENT_GAMES,
  type MatchupGame,
} from "#src/trpc/router/consumer/champion-matchup/matchup-tally.ts";
import type { ChampionPagePerson } from "#src/trpc/router/consumer/consumer-champion-people.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const RecentGameStatsSchema = z.object({
  match_id: RiotMatchIdSchema,
  puuid: z.string(),
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  early_surrendered: z.boolean(),
  end_of_game_result: z.string().nullable(),
});

export type RecentGameStats = z.infer<typeof RecentGameStatsSchema>;

export type MatchupLakeRead =
  | { status: "unavailable" }
  | {
      status: "available";
      /** Every game in the matchup, newest first, one per person and match. */
      games: MatchupGame[];
      /** The viewer's newest games' scoreline, by match. */
      recentStats: Map<RiotMatchId, RecentGameStats>;
    };

/**
 * The matchup page's whole lake read, on one slot: the lane results of the
 * people in scope who played `championId` against `opponentChampionId` in
 * `lane`, then the scoreline of the viewer's newest of those games.
 *
 * The pairing and the 15:00 figures come from `lane_results` alone. While that
 * table is gated or empty the page has no matchup to show: `unavailable`.
 */
export async function readMatchupLake(options: {
  people: readonly ChampionPagePerson[];
  championId: number;
  opponentChampionId: number;
  lane: Lane;
  lakeDir?: string | undefined;
}): Promise<MatchupLakeRead> {
  const puuids = options.people.flatMap((person) => person.puuids);
  return await withLakePage(options.lakeDir, async (page) => {
    const read = await readLaneResultsOnPage(page, {
      sql: "puuid IN (SELECT unnest(?)) AND champion_id = ? AND opponent_champion_id = ? AND role = ?",
      params: [
        listParam(puuids),
        scalarParam(options.championId),
        scalarParam(options.opponentChampionId),
        scalarParam(options.lane),
      ],
    });
    if (read.status === "unavailable") return read;
    const games = attributeMatchupGames(read.rows, options.people);
    const recent = games
      .filter((game) => game.isViewer)
      .slice(0, MATCHUP_RECENT_GAMES)
      .map((game) => game.row);
    return {
      status: "available",
      games,
      recentStats: await readRecentStats(page, recent),
    };
  });
}

async function readRecentStats(
  page: LakePage,
  rows: readonly LaneResultReadRow[],
): Promise<Map<RiotMatchId, RecentGameStats>> {
  if (rows.length === 0) return new Map();
  const source = buildMatchesSource(page.files, {
    sql: "match_id IN (SELECT unnest(?)) AND puuid IN (SELECT unnest(?))",
    params: [
      listParam(rows.map((row) => row.match_id)),
      listParam(rows.flatMap((row) => (row.puuid === null ? [] : [row.puuid]))),
    ],
  });
  if (source === undefined) return new Map();
  const stats = await runSource({
    session: page.session,
    source,
    sql:
      `SELECT match_id, puuid, kills, deaths, assists, early_surrendered, end_of_game_result ` +
      `FROM (${source.sql}) QUALIFY row_number() OVER (PARTITION BY match_id ORDER BY puuid) = 1`,
    schema: RecentGameStatsSchema,
  });
  return new Map(stats.map((row) => [row.match_id, row] as const));
}
