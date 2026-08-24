import {
  RankSchema,
  parseCompetition,
  rankToLeaguePoints,
  rankToString,
} from "@scout-for-lol/data";
import type {
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { calculateLeaderboard } from "#src/league/competition/leaderboard.ts";
import type { CachedLeaderboardEntry } from "@scout-for-lol/data";
import { collectAggregateColumnNames } from "#src/reports/duckdb/aggregate-sql.ts";
import {
  requireGuildScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import { effectiveRowLimit } from "#src/reports/query-aggregates.ts";
import { planResultColumnNames } from "#src/reports/plan-columns.ts";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

/**
 * The rank snapshot sources (`rank_current`, `competition_rank`).
 *
 * These have no lake table: a "current rank" is a live standing, computed by
 * the competition leaderboard from the database. Their catalog exposes exactly
 * two measurable columns — `score` and `rank` — and no time column at all,
 * which is why their plans carry a `snapshot` window.
 */

export type RankReportInput = {
  prisma: ExtendedPrismaClient;
  scope: LakeQueryScope;
  plan: ScoutQlPlan;
  competitionId: number;
  now: Date;
};

export async function rankReportResult(
  input: RankReportInput,
): Promise<ReportQueryResult> {
  const serverId = requireGuildScope(input.scope, "Competition reports");
  const competition = parseCompetition(
    await input.prisma.competition.findUniqueOrThrow({
      where: { id: input.competitionId },
      include: { season: true },
    }),
  );
  if (competition.serverId !== serverId) {
    throw new Error("Report competition does not belong to this server.");
  }
  const leaderboard = await calculateLeaderboard(input.prisma, competition);
  const showsRankNames = competition.criteria.type === "HIGHEST_RANK";
  const limit = effectiveRowLimit(input.plan);
  return {
    plan: input.plan,
    columns: planResultColumnNames(input.plan),
    rows: leaderboard.slice(0, limit).map((entry) => ({
      label: entry.playerName,
      dimensions: [entry.playerName],
      // A leaderboard row is keyed by the player it names; there is no SQL
      // grouping key behind it.
      keys: [entry.playerName],
      mentionIdentity: {
        kind: "player",
        // Preserve the leaderboard's player id so the live playerDiscordIds map
        // stays authoritative: a player who unlinks between leaderboard
        // calculation and map load falls back to the alias instead of pinging
        // the stale snapshot discordId (same handling as lake-backed reports).
        playerId: entry.playerId,
        alias: entry.playerName,
        discordId: entry.discordId ?? null,
      },
      values: input.plan.outputs.map((output) => ({
        column: output.name,
        value: rankOutputValue(output, entry, showsRankNames),
      })),
    })),
    rowsScanned: leaderboard.length,
    // A snapshot answers "as of now"; it has no window to state.
    range: { startDate: new Date(0), endDate: input.now },
  };
}

/**
 * What one output reads off a leaderboard entry, decided by the column its
 * expression names rather than by the alias the author chose. `score` is the
 * criterion's own measure — rendered as a rank name when the criterion IS a
 * rank — and `rank` is the position within the standings.
 */
function rankOutputValue(
  output: ScoutQlOutput,
  entry: CachedLeaderboardEntry,
  showsRankNames: boolean,
): number | string | null {
  if (output.expr.kind === "grouping-ref") {
    return entry.playerName;
  }
  const referenced = new Set<string>();
  collectAggregateColumnNames(output.expr, referenced);
  if (referenced.has("rank") && !referenced.has("score")) {
    return entry.rank;
  }
  if (!referenced.has("score")) {
    throw new Error(
      `Output "${output.name}" reads no rank-snapshot column; these sources expose only score and rank.`,
    );
  }
  return showsRankNames
    ? rankToString(RankSchema.parse(entry.score))
    : scoreToNumber(entry.score);
}

function scoreToNumber(score: CachedLeaderboardEntry["score"]): number {
  const rank = RankSchema.safeParse(score);
  if (rank.success) {
    return rankToLeaguePoints(rank.data);
  }
  return typeof score === "number" ? score : 0;
}
