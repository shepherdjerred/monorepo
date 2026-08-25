import {
  CompetitionAnalysisPresetSchema,
  VisualizationSnapshotSchema,
  rankToLeaguePoints,
  resolveTemporalBucket,
  temporalWindowDays,
  type CachedLeaderboard,
  type CachedLeaderboardEntry,
  type CompetitionAnalysisPreset,
  type CompetitionCriteria,
  type CompetitionWithCriteria,
  type TemporalAnalysisSpec,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  competitionAnnotations,
  withCompetitionAnnotations,
} from "#src/league/competition/analysis-annotations.ts";
import {
  competitionAnalysisSpec,
  resolveCompetitionAnalysisDates,
} from "#src/league/competition/analysis-dates.ts";
import {
  competitionCriterionQuery,
  temporalPresetQuery,
} from "#src/league/competition/analysis-queries.ts";
import { standingsFromResult } from "#src/league/competition/analysis-results.ts";
import { executeCompiledReportQuery } from "#src/reports/query-engine.ts";
import type { ReportQueryResult } from "#src/reports/query-types.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import {
  clampTemporalRange,
  resolveTemporalRanges,
} from "#src/reports/temporal-range.ts";
import { createBoundedAsyncCache } from "#src/utils/bounded-async-cache.ts";

export type CompetitionAnalysisResult = {
  preset: CompetitionAnalysisPreset;
  mode: "official" | "selected_period";
  standings: CachedLeaderboardEntry[];
  visualization: VisualizationSnapshot | null;
  rowsScanned: number;
};

export const cachedCompetitionAnalysis =
  createBoundedAsyncCache<CompetitionAnalysisResult>({
    ttlMs: 60_000,
    maxEntries: 100,
    maxConcurrent: 2,
    now: Date.now,
  });

export function clearCompetitionAnalysisCache(): void {
  cachedCompetitionAnalysis.clear();
}

type AnalyzeCompetitionParams = {
  prisma: ExtendedPrismaClient;
  competition: CompetitionWithCriteria;
  mode: "official" | "selected_period";
  preset: CompetitionAnalysisPreset;
  startDate: string;
  endDate: string;
  history: CachedLeaderboard[];
  official: CachedLeaderboard | null;
  now: Date;
};

export async function analyzeCompetition(
  params: AnalyzeCompetitionParams,
): Promise<CompetitionAnalysisResult> {
  const preset = CompetitionAnalysisPresetSchema.parse(params.preset);
  if (preset === "criterion_score" && params.mode === "official") {
    return {
      preset,
      mode: params.mode,
      standings: params.official?.entries ?? [],
      visualization: null,
      rowsScanned: 0,
    };
  }
  const dates = resolveCompetitionAnalysisDates(params);
  const requestedAnalysis = competitionAnalysisSpec({
    ...dates,
    timezone: params.competition.analysisTimezone,
  });
  const range = clampTemporalRange(
    resolveTemporalRanges(requestedAnalysis, params.now).current,
    params.competition,
    params.now,
  );
  const analysis = competitionAnalysisSpec({
    ...range,
    timezone: params.competition.analysisTimezone,
  });
  const officialStandings = params.official?.entries ?? [];
  const rankCriterion = competitionUsesRankHistory(params.competition.criteria);
  if (preset === "rank_position") {
    return await analyzeRankPosition({
      params,
      analysis,
      range,
      officialStandings,
      rankCriterion,
    });
  }
  if (rankCriterion) {
    const filtered = historyAroundRange(params.history, range);
    const standings =
      params.mode === "official"
        ? officialStandings
        : rankPeriodStandings(params.competition, filtered);
    if (preset !== "criterion_score") {
      const visualizationResult = await executeCompiledReportQuery(
        {
          prisma: params.prisma,
          scope: guildScope(params.competition.serverId),
          sourceCompetitionId: params.competition.id,
          now: params.now,
          rangeOverride: range,
        },
        compileScoutQl(
          temporalPresetQuery({
            preset,
            competitionId: params.competition.id,
            analysis,
          }),
        ),
      );
      return {
        preset,
        mode: params.mode,
        standings,
        visualization: withCompetitionAnnotations(
          visualizationResult.visualization ?? null,
          params.competition,
        ),
        rowsScanned:
          filtered.reduce(
            (total, snapshot) => total + snapshot.entries.length,
            0,
          ) + visualizationResult.rowsScanned,
      };
    }
    return {
      preset,
      mode: params.mode,
      standings,
      visualization: rankHistoryVisualization(
        params.competition,
        analysis,
        filtered,
        params.now,
      ),
      rowsScanned: filtered.reduce(
        (total, snapshot) => total + snapshot.entries.length,
        0,
      ),
    };
  }

  const standingsResult =
    params.mode === "official"
      ? null
      : await executeCompiledReportQuery(
          {
            prisma: params.prisma,
            scope: guildScope(params.competition.serverId),
            sourceCompetitionId: params.competition.id,
            now: params.now,
            rangeOverride: range,
          },
          compileScoutQl(
            competitionCriterionQuery(
              params.competition.criteria,
              params.competition.id,
              params.competition.gameVariant,
            ),
          ),
        );
  const visualizationResult =
    preset === "criterion_score"
      ? requireStandingsResult(standingsResult)
      : await executeCompiledReportQuery(
          {
            prisma: params.prisma,
            scope: guildScope(params.competition.serverId),
            sourceCompetitionId: params.competition.id,
            now: params.now,
            rangeOverride: range,
          },
          compileScoutQl(
            temporalPresetQuery({
              preset,
              competitionId: params.competition.id,
              analysis,
            }),
          ),
        );
  return {
    preset,
    mode: params.mode,
    standings:
      params.mode === "official"
        ? officialStandings
        : standingsFromResult(requireStandingsResult(standingsResult)),
    visualization: withCompetitionAnnotations(
      visualizationResult.visualization ?? null,
      params.competition,
    ),
    rowsScanned:
      (standingsResult?.rowsScanned ?? 0) +
      (visualizationResult === standingsResult
        ? 0
        : visualizationResult.rowsScanned),
  };
}

async function analyzeRankPosition(input: {
  params: AnalyzeCompetitionParams;
  analysis: TemporalAnalysisSpec;
  range: { startDate: Date; endDate: Date };
  officialStandings: CachedLeaderboardEntry[];
  rankCriterion: boolean;
}): Promise<CompetitionAnalysisResult> {
  const { params, analysis, range, officialStandings, rankCriterion } = input;
  const filtered = historyAroundRange(params.history, range);
  const standingsResult =
    !rankCriterion && params.mode === "selected_period"
      ? await executeCompiledReportQuery(
          {
            prisma: params.prisma,
            scope: guildScope(params.competition.serverId),
            sourceCompetitionId: params.competition.id,
            now: params.now,
            rangeOverride: range,
          },
          compileScoutQl(
            competitionCriterionQuery(
              params.competition.criteria,
              params.competition.id,
              params.competition.gameVariant,
            ),
          ),
        )
      : null;
  return {
    preset: "rank_position",
    mode: params.mode,
    standings:
      params.mode === "official"
        ? officialStandings
        : rankCriterion
          ? rankPeriodStandings(params.competition, filtered)
          : standingsFromResult(requireStandingsResult(standingsResult)),
    visualization: rankHistoryVisualization(
      params.competition,
      analysis,
      filtered,
      params.now,
    ),
    rowsScanned: filtered.reduce(
      (total, snapshot) => total + snapshot.entries.length,
      standingsResult?.rowsScanned ?? 0,
    ),
  };
}

function competitionUsesRankHistory(criteria: CompetitionCriteria): boolean {
  return (
    criteria.type === "HIGHEST_RANK" || criteria.type === "MOST_RANK_CLIMB"
  );
}

function requireStandingsResult(
  result: ReportQueryResult | null,
): ReportQueryResult {
  if (result === null) {
    throw new Error("Missing selected-period competition standings.");
  }
  return result;
}

function historyAroundRange(
  history: CachedLeaderboard[],
  range: { startDate: Date; endDate: Date },
): CachedLeaderboard[] {
  const sorted = history.toSorted((left, right) =>
    left.calculatedAt.localeCompare(right.calculatedAt),
  );
  const inside = sorted.filter((snapshot) => {
    const timestamp = new Date(snapshot.calculatedAt);
    return timestamp >= range.startDate && timestamp <= range.endDate;
  });
  const before = sorted.findLast(
    (snapshot) => new Date(snapshot.calculatedAt) <= range.startDate,
  );
  const endBoundary = sorted.findLast(
    (snapshot) => new Date(snapshot.calculatedAt) <= range.endDate,
  );
  return [
    ...(before === undefined ? [] : [before]),
    ...inside,
    ...(endBoundary === undefined ? [] : [endBoundary]),
  ]
    .filter(
      (snapshot, index, candidates) =>
        candidates.findIndex(
          (candidate) => candidate.calculatedAt === snapshot.calculatedAt,
        ) === index,
    )
    .toSorted((left, right) =>
      left.calculatedAt.localeCompare(right.calculatedAt),
    );
}

function rankPeriodStandings(
  competition: CompetitionWithCriteria,
  history: CachedLeaderboard[],
): CachedLeaderboardEntry[] {
  if (history.length === 0) return [];
  const first = history[0];
  const last = history.at(-1);
  if (first === undefined || last === undefined) return [];
  const firstByPlayer = new Map(
    first.entries.map((entry) => [entry.playerId, entry]),
  );
  if (competition.criteria.type === "MOST_RANK_CLIMB") {
    return last.entries
      .map((entry) => ({
        ...entry,
        score:
          scoreNumber(entry.score) -
          scoreNumber(firstByPlayer.get(entry.playerId)?.score ?? 0),
      }))
      .toSorted(
        (left, right) => scoreNumber(right.score) - scoreNumber(left.score),
      )
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
  const best = new Map<number, CachedLeaderboardEntry>();
  for (const snapshot of history) {
    for (const entry of snapshot.entries) {
      const current = best.get(entry.playerId);
      if (
        current === undefined ||
        scoreNumber(entry.score) > scoreNumber(current.score)
      ) {
        best.set(entry.playerId, entry);
      }
    }
  }
  return [...best.values()]
    .toSorted(
      (left, right) => scoreNumber(right.score) - scoreNumber(left.score),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function scoreNumber(score: CachedLeaderboardEntry["score"]): number {
  return typeof score === "number" ? score : rankToLeaguePoints(score);
}

function rankHistoryVisualization(
  competition: CompetitionWithCriteria,
  analysis: TemporalAnalysisSpec,
  history: CachedLeaderboard[],
  now: Date,
): VisualizationSnapshot | null {
  if (history.length === 0) return null;
  const latest = history.at(-1);
  if (latest === undefined) return null;
  const playerIds = latest.entries.slice(0, 8).map((entry) => entry.playerId);
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: now.toISOString(),
    kind: "BUMP_CHART",
    title: `${competition.title} rank positions`,
    temporal: analysis,
    bucket: resolveTemporalBucket(
      analysis.bucket,
      temporalWindowDays(analysis.window),
    ),
    display: {
      theme: "lol_dark",
      palette: "ranked",
      smooth: false,
      stack: "none",
      rollingWindow: null,
      cumulative: false,
      sparkline: true,
    },
    series: playerIds.map((playerId) => {
      const latestEntry = latest.entries.find(
        (entry) => entry.playerId === playerId,
      );
      return {
        id: `rank:${playerId.toString()}`,
        label: latestEntry?.playerName ?? `Player ${playerId.toString()}`,
        metric: "rank_position",
        additive: false,
        points: history.flatMap((snapshot) => {
          const entry = snapshot.entries.find(
            (candidate) => candidate.playerId === playerId,
          );
          return entry === undefined
            ? []
            : [
                {
                  key: snapshot.calculatedAt,
                  label: snapshot.calculatedAt.slice(0, 10),
                  start: new Date(snapshot.calculatedAt).toISOString(),
                  end: new Date(snapshot.calculatedAt).toISOString(),
                  value: entry.rank,
                  evidence: { sampleSize: 1 },
                },
              ];
        }),
      };
    }),
    annotations: competitionAnnotations(competition),
    trends: [],
  });
}
