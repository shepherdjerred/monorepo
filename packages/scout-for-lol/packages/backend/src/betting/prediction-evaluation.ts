import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { REMAKE_MAX_DURATION_SECONDS } from "#src/betting/constants.ts";
import {
  buildMatchesSource,
  buildPredictionObservationsSource,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";

export type PredictionEvaluationInput = {
  queue: string;
  dataQuality: string;
  probability: number;
  blueWon: boolean;
};

export type PredictionMetrics = {
  sampleSize: number;
  brierScore: number;
  logLoss: number;
  calibrationError: number;
  directionalAccuracy: number;
};

export type PredictionEvaluationReport = {
  overall: PredictionMetrics;
  reference50: PredictionMetrics;
  byQueue: Record<string, PredictionMetrics>;
  byQuality: Record<string, PredictionMetrics>;
};

const EvaluationRowSchema = z.object({
  queue: z.string(),
  data_quality: z.string(),
  probability: z.number(),
  blue_won: z.boolean(),
});

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

export function calculatePredictionMetrics(
  observations: readonly PredictionEvaluationInput[],
): PredictionMetrics {
  if (observations.length === 0) {
    return {
      sampleSize: 0,
      brierScore: 0,
      logLoss: 0,
      calibrationError: 0,
      directionalAccuracy: 0,
    };
  }
  const brierScore = mean(
    observations.map((row) => {
      const outcome = row.blueWon ? 1 : 0;
      return (row.probability - outcome) ** 2;
    }),
  );
  const logLoss = mean(
    observations.map((row) => {
      const p = Math.min(Math.max(row.probability, 1e-15), 1 - 1e-15);
      return row.blueWon ? -Math.log(p) : -Math.log(1 - p);
    }),
  );
  const directionalAccuracy = mean(
    observations.map((row) => {
      if (row.probability === 0.5) {
        return 0.5;
      }
      return row.probability > 0.5 === row.blueWon ? 1 : 0;
    }),
  );

  let calibrationError = 0;
  for (let bin = 0; bin < 10; bin++) {
    const inBin = observations.filter(
      (row) => Math.min(Math.floor(row.probability * 10), 9) === bin,
    );
    if (inBin.length === 0) {
      continue;
    }
    const averageProbability = mean(inBin.map((row) => row.probability));
    const observedRate =
      inBin.filter((row) => row.blueWon).length / inBin.length;
    calibrationError +=
      (inBin.length / observations.length) *
      Math.abs(averageProbability - observedRate);
  }

  return {
    sampleSize: observations.length,
    brierScore,
    logLoss,
    calibrationError,
    directionalAccuracy,
  };
}

function groupMetrics(
  observations: readonly PredictionEvaluationInput[],
  key: (row: PredictionEvaluationInput) => string,
): Record<string, PredictionMetrics> {
  const groups = new Map<string, PredictionEvaluationInput[]>();
  for (const observation of observations) {
    const group = key(observation);
    groups.set(group, [...(groups.get(group) ?? []), observation]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([group, rows]) => [group, calculatePredictionMetrics(rows)]),
  );
}

export function evaluatePredictions(
  observations: readonly PredictionEvaluationInput[],
): PredictionEvaluationReport {
  const reference = observations.map((row) => ({ ...row, probability: 0.5 }));
  return {
    overall: calculatePredictionMetrics(observations),
    reference50: calculatePredictionMetrics(reference),
    byQueue: groupMetrics(observations, (row) => row.queue),
    byQuality: groupMetrics(observations, (row) => row.dataQuality),
  };
}

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

export async function loadPredictionEvaluationRows(
  lakeDir: string = resolveLakeDir(),
): Promise<PredictionEvaluationInput[]> {
  const files = await resolveLakeFiles(lakeDir);
  const predictions = buildPredictionObservationsSource(files, {
    sql: "",
    params: [],
  });
  const matches = buildMatchesSource(files, { sql: "", params: [] });
  if (predictions === undefined || matches === undefined) {
    return [];
  }
  const rows = await withDuckDBConnection(async (session) => {
    return await session.run(
      `WITH outcomes AS (` +
        `SELECT match_id, bool_or(win) FILTER (WHERE team_id = 100) AS blue_won ` +
        `FROM (${matches.sql}) GROUP BY match_id ` +
        `HAVING min(game_duration_seconds) >= ? ` +
        `AND NOT bool_or(game_ended_in_early_surrender OR team_early_surrendered) ` +
        `AND bool_and(end_of_game_result = 'GameComplete')` +
        `) SELECT predictions.queue, predictions.data_quality, ` +
        `predictions.blue_win_probability AS probability, outcomes.blue_won ` +
        `FROM (${predictions.sql}) predictions ` +
        `INNER JOIN outcomes USING (match_id) ` +
        `WHERE outcomes.blue_won IS NOT NULL`,
      bindParams(session, [
        ...matches.params,
        scalarParam(REMAKE_MAX_DURATION_SECONDS),
        ...predictions.params,
      ]),
    );
  });
  return rows.map((row) => {
    const parsed = EvaluationRowSchema.parse(row);
    return {
      queue: parsed.queue,
      dataQuality: parsed.data_quality,
      probability: parsed.probability,
      blueWon: parsed.blue_won,
    };
  });
}
