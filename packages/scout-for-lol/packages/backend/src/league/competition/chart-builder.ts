import type { AttachmentBuilder } from "discord.js";
import { AttachmentBuilder as DiscordAttachmentBuilder } from "discord.js";
import { match } from "ts-pattern";
import * as Sentry from "@sentry/bun";
import { z } from "zod";
import {
  type CachedLeaderboard,
  type CachedLeaderboardEntry,
  type CompetitionWithCriteria,
  type CompetitionCriteria,
  type PlayerId,
  RankSchema,
  rankToLeaguePoints,
} from "@scout-for-lol/data/index.ts";
import {
  competitionChartToImage,
  type CompetitionChartProps,
  type CompetitionChartSeries,
  type CompetitionChartBar,
} from "@scout-for-lol/report";
import { formatCriteriaDescription } from "#src/discord/embeds/competition-format-helpers.ts";
import { loadHistoricalLeaderboardSnapshots } from "#src/storage/s3-leaderboard.ts";
import type { RankedLeaderboardEntry } from "#src/league/competition/leaderboard.ts";
import { createLogger } from "#src/logger.ts";
import { logNotification } from "#src/utils/notification-logger.ts";
import {
  leaderboardChartRendersTotal,
  leaderboardChartRenderDurationSeconds,
  leaderboardChartPngBytes,
} from "#src/metrics/index.ts";

const logger = createLogger("competition-chart-builder");

const TOP_N = 10;
const MIN_SNAPSHOTS_FOR_LINE_CHART = 2;

/**
 * Cumulative count metrics render as a horizontal bar chart of current
 * standings — trend over time is monotonic and uninteresting; magnitude
 * comparisons between players are what users actually want to see.
 *
 * Everything else (rank ladder, LP delta, win rate) renders as a line
 * chart since the value fluctuates over time.
 */
function chartTypeForCriteria(criteria: CompetitionCriteria): "bar" | "line" {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, () => "bar" as const)
    .with({ type: "MOST_WINS_PLAYER" }, () => "bar" as const)
    .with({ type: "MOST_WINS_CHAMPION" }, () => "bar" as const)
    .with({ type: "HIGHEST_RANK" }, () => "line" as const)
    .with({ type: "MOST_RANK_CLIMB" }, () => "line" as const)
    .with({ type: "HIGHEST_WIN_RATE" }, () => "line" as const)
    .exhaustive();
}

/**
 * Map a competition criteria to the value-axis label shown on the chart.
 */
function valueAxisLabelForCriteria(criteria: CompetitionCriteria): string {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, () => "Games")
    .with({ type: "HIGHEST_RANK" }, () => "Ladder points")
    .with({ type: "MOST_RANK_CLIMB" }, () => "LP gained")
    .with({ type: "MOST_WINS_PLAYER" }, () => "Wins")
    .with({ type: "MOST_WINS_CHAMPION" }, () => "Wins")
    .with({ type: "HIGHEST_WIN_RATE" }, () => "Win rate (%)")
    .exhaustive();
}

/**
 * Convert a leaderboard entry's score (number | Rank) to the numeric value
 * we plot on the chart. For rank-based competitions, flatten the Rank object
 * to its ladder-point equivalent via the existing `rankToLeaguePoints` helper.
 */
const NumericScoreSchema = z.number();
function entryToPlotValue(entry: CachedLeaderboardEntry): number {
  const rankResult = RankSchema.safeParse(entry.score);
  if (rankResult.success) {
    return rankToLeaguePoints(rankResult.data);
  }
  return NumericScoreSchema.parse(entry.score);
}

function leaderboardEntryToPlotValue(entry: RankedLeaderboardEntry): number {
  const rankResult = RankSchema.safeParse(entry.score);
  if (rankResult.success) {
    return rankToLeaguePoints(rankResult.data);
  }
  return NumericScoreSchema.parse(entry.score);
}

/**
 * Build a per-player time series across all loaded snapshots.
 * Players missing from a given snapshot get a `null` value so the line
 * breaks cleanly across the gap.
 */
function buildSeries(
  topPlayers: { playerId: PlayerId; playerName: string }[],
  snapshots: CachedLeaderboard[],
): CompetitionChartSeries[] {
  return topPlayers.map(({ playerId, playerName }) => {
    const points = snapshots.map((snapshot) => {
      const date = new Date(snapshot.calculatedAt);
      const entry = snapshot.entries.find(
        (candidate) => candidate.playerId === playerId,
      );
      if (entry === undefined) {
        return { date, value: null };
      }
      return { date, value: entryToPlotValue(entry) };
    });
    return { playerName, points };
  });
}

function buildBars(
  topEntries: RankedLeaderboardEntry[],
): CompetitionChartBar[] {
  return topEntries.map((entry) => ({
    playerName: entry.playerName,
    value: leaderboardEntryToPlotValue(entry),
  }));
}

/**
 * Resolve the chart's x-axis time window for line charts:
 * - startDate = competition.startDate (always populated by parseCompetition)
 * - endDate   = min(now, competition.endDate) so trailing whitespace doesn't
 *              dominate the chart while the competition is still active
 */
function resolveTimeWindow(
  competition: CompetitionWithCriteria,
): { startDate: Date; endDate: Date } | null {
  if (competition.startDate === null || competition.endDate === null) {
    logger.warn(
      `[CompetitionChart] ⚠️  Competition ${competition.id.toString()} has missing startDate/endDate, skipping chart`,
    );
    return null;
  }
  const now = new Date();
  const endDate =
    competition.endDate.getTime() < now.getTime() ? competition.endDate : now;
  return { startDate: competition.startDate, endDate };
}

/**
 * Build a Discord PNG attachment of the competition's leaderboard chart.
 *
 * The chart type is decided by the competition's criteria:
 * - `MOST_GAMES_PLAYED` / `MOST_WINS_*` render as a horizontal bar chart of
 *   the current top-10 standings (no historical snapshots needed).
 * - `HIGHEST_RANK` / `MOST_RANK_CLIMB` / `HIGHEST_WIN_RATE` render as a
 *   line chart of each top-10 player's value over the competition lifetime.
 *
 * Returns `null` when the chart can't or shouldn't be rendered:
 * - line chart needs ≥2 historical snapshots in S3
 * - missing competition dates (schema invariant violation — logged)
 * - empty current leaderboard (nothing to render)
 * - any error during snapshot fetch / rendering (logged + Sentry, never thrown)
 *
 * The chart is best-effort. A missing chart never blocks the daily update.
 */
export async function buildCompetitionChartAttachment(
  competition: CompetitionWithCriteria,
  currentLeaderboard: RankedLeaderboardEntry[],
): Promise<AttachmentBuilder | null> {
  const criteriaType = competition.criteria.type;
  const start = Date.now();

  const observe = (status: string): void => {
    leaderboardChartRenderDurationSeconds.observe(
      { criteria_type: criteriaType, status },
      (Date.now() - start) / 1000,
    );
  };
  const inc = (status: string): void => {
    leaderboardChartRendersTotal.inc({
      criteria_type: criteriaType,
      status,
    });
  };

  try {
    const chartType = chartTypeForCriteria(competition.criteria);
    logger.info(
      `[CompetitionChart] 📊 Rendering ${chartType} chart for competition ${competition.id.toString()} (${criteriaType})`,
    );

    if (currentLeaderboard.length === 0) {
      logger.info(
        `[CompetitionChart] ⚠️  Skipping chart for competition ${competition.id.toString()} — leaderboard is empty`,
      );
      observe("skipped_too_few_snapshots");
      inc("skipped_too_few_snapshots");
      return null;
    }

    const topEntries = currentLeaderboard.slice(0, TOP_N);
    const props = await match(chartType)
      .with("bar", (): Promise<CompetitionChartProps> => {
        return Promise.resolve({
          chartType: "bar",
          title: competition.title,
          subtitle: formatCriteriaDescription(competition.criteria),
          yAxisLabel: valueAxisLabelForCriteria(competition.criteria),
          bars: buildBars(topEntries),
        });
      })
      .with("line", async (): Promise<CompetitionChartProps | null> => {
        const window = resolveTimeWindow(competition);
        if (window === null) {
          return null;
        }
        const snapshots = await loadHistoricalLeaderboardSnapshots(
          competition.id,
        );
        if (snapshots.length < MIN_SNAPSHOTS_FOR_LINE_CHART) {
          logger.info(
            `[CompetitionChart] ⚠️  Skipping line chart for competition ${competition.id.toString()} — only ${snapshots.length.toString()} snapshot(s) available`,
          );
          return null;
        }
        return {
          chartType: "line",
          title: competition.title,
          subtitle: formatCriteriaDescription(competition.criteria),
          yAxisLabel: valueAxisLabelForCriteria(competition.criteria),
          startDate: window.startDate,
          endDate: window.endDate,
          series: buildSeries(
            topEntries.map((e) => ({
              playerId: e.playerId,
              playerName: e.playerName,
            })),
            snapshots,
          ),
        };
      })
      .exhaustive();

    if (props === null) {
      observe("skipped_too_few_snapshots");
      inc("skipped_too_few_snapshots");
      return null;
    }

    const buffer = await competitionChartToImage(props);
    leaderboardChartPngBytes.observe(
      { criteria_type: criteriaType },
      buffer.length,
    );

    const attachment = new DiscordAttachmentBuilder(buffer, {
      name: `competition-${competition.id.toString()}-${chartType === "bar" ? "standings" : "trend"}.png`,
    });

    observe("success");
    inc("success");
    logger.info(
      `[CompetitionChart] ✅ Rendered ${chartType} chart for ${topEntries.length.toString()} players, ${(Date.now() - start).toString()}ms, ${buffer.length.toString()} bytes`,
    );
    return attachment;
  } catch (error) {
    observe("error");
    inc("error");
    logger.error(
      `[CompetitionChart] ❌ Failed to render chart for competition ${competition.id.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "competition-chart-builder",
        competitionId: competition.id.toString(),
        criteriaType,
      },
    });
    logNotification(
      "LEADERBOARD_CHART_FAILED",
      "chart-builder:buildCompetitionChartAttachment",
      {
        competitionId: competition.id,
        competitionTitle: competition.title,
        message: `${criteriaType}: ${String(error).slice(0, 180)}`,
      },
    );
    return null;
  }
}
