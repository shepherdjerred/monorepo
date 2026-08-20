import { z } from "zod";
import { REMAKE_MAX_DURATION_SECONDS } from "#src/betting/constants.ts";
import type {
  ParlayHistoryMatch,
  ParlayHistoryQueue,
} from "#src/betting/parlay-history.ts";
import {
  OPPONENT_PING_HISTORY_COLUMNS,
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import type { ModelParlayProposal } from "#src/betting/parlay-model-schema.ts";
import type { ParlaySubject } from "#src/betting/parlay-criteria.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import type { MatchLakeRow } from "#src/report-lake/schema.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";

/**
 * The distributions a parlay's thresholds are chosen against.
 *
 * Two frames, both sliced by game duration. The player frame says what this
 * person actually does; the population frame says what the lane does, which is
 * what makes the player's number readable. `visionScore >= 25` is a 94% freebie
 * for a support and a coin flip for a jungler, and only the pair of frames
 * distinguishes those.
 *
 * The player frame carries duration and lane as separate marginals, never
 * crossed. Crossing them is what turned a player with 157 games into a cell of
 * 18. The population frame can afford the cross (every cell holds 200+ rows),
 * which is what lets the interaction be read there and applied to the player's
 * marginals rather than assumed additive.
 */

/** Bucket labels, open at both ends: 10 is under 15m, 50 is 45m and up. */
export const DURATION_BUCKETS = [10, 20, 30, 40, 50] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const PARLAY_LANES = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
] as const;
export type ParlayLane = (typeof PARLAY_LANES)[number];

/**
 * Cuts are named by the hit rate they produce, not by percentile.
 *
 * The model reasons in "give me a leg that lands about half the time", and
 * percentile naming makes it invert that itself — in opposite directions for
 * `gte` and `lte`. Resolving the direction here against the operator proposed
 * in pass one means the number means exactly what its label says.
 */
export const HIT_RATES = [90, 70, 50, 30, 10] as const;
export type HitRate = (typeof HIT_RATES)[number];

/** Probabilities queried once; the operator decides which maps to which rate. */
export type ParlayOperator = "gte" | "lte";

export type StatCell = {
  n: number;
  thresholds: Record<HitRate, number>;
  realizedRates: Record<HitRate, number>;
};

export type PlayerFrame = {
  overall: StatCell;
  byBucket: Partial<Record<DurationBucket, StatCell>>;
  byLane: Partial<Record<ParlayLane, StatCell>>;
};

export type PopulationFrame = {
  overall: StatCell;
  byBucket: Partial<Record<DurationBucket, StatCell>>;
  byLaneAndBucket: Partial<
    Record<ParlayLane, Partial<Record<DurationBucket, StatCell>>>
  >;
};

/** Below this a player cell is noise dressed as evidence, so it is omitted. */
export const MIN_PLAYER_CELL_GAMES = 10;

export function durationBucket(seconds: number): DurationBucket {
  if (seconds < 900) return 10;
  if (seconds < 1500) return 20;
  if (seconds < 2100) return 30;
  if (seconds < 2700) return 40;
  return 50;
}

function cellFromValues(
  values: readonly number[],
  operator: ParlayOperator,
): StatCell {
  const sorted = [...values].sort((left, right) => left - right);
  const candidates: {
    threshold: number;
    gteCount: number;
    lteCount: number;
  }[] = [];
  let start = 0;
  for (let end = 1; end <= sorted.length; end += 1) {
    if (end < sorted.length && sorted[end] === sorted[start]) {
      continue;
    }
    candidates.push({
      threshold: sorted[start] ?? 0,
      gteCount: sorted.length - start,
      lteCount: end,
    });
    start = end;
  }
  const thresholdAndRate = (rate: HitRate): readonly [number, number] => {
    const target = rate / 100;
    let best: readonly [number, number] = [candidates[0]?.threshold ?? 0, 0];
    for (const candidate of candidates) {
      const count =
        operator === "gte" ? candidate.gteCount : candidate.lteCount;
      const realized = sorted.length === 0 ? 0 : count / sorted.length;
      const bestDistance = Math.abs(best[1] - target);
      const distance = Math.abs(realized - target);
      if (distance < bestDistance) {
        best = [candidate.threshold, realized];
      }
    }
    return best;
  };
  const thresholdRates = HIT_RATES.map(
    (rate) => [rate, thresholdAndRate(rate)] as const,
  );
  const thresholds = Object.fromEntries(
    thresholdRates.map(([rate, [threshold]]) => [rate, threshold]),
  );
  const realizedRates = Object.fromEntries(
    thresholdRates.map(([rate, [, realized]]) => [rate, realized]),
  );
  return {
    n: sorted.length,
    thresholds: z.record(z.coerce.number(), z.number()).parse(thresholds),
    realizedRates: z.record(z.coerce.number(), z.number()).parse(realizedRates),
  };
}

/** Player marginals, computed from the same rows the price is replayed over. */
export function buildPlayerFrame(input: {
  matches: readonly ParlayHistoryMatch[];
  column: keyof MatchLakeRow;
  operator: ParlayOperator;
  team: boolean;
  opponent?: boolean;
}): PlayerFrame {
  const read = (match: ParlayHistoryMatch): number | undefined => {
    const source =
      input.opponent === true
        ? match.opponentValues
        : input.team
          ? match.teamValues
          : match.values;
    if (input.column === "game_duration_seconds") {
      return match.durationSeconds;
    }
    return source.get(input.column);
  };

  const values = (matches: readonly ParlayHistoryMatch[]): number[] =>
    matches.flatMap((match) => {
      const value = read(match);
      return value === undefined ? [] : [value];
    });

  const byBucket: Partial<Record<DurationBucket, StatCell>> = {};
  for (const bucket of DURATION_BUCKETS) {
    const bucketValues = values(
      input.matches.filter(
        (match) => durationBucket(match.durationSeconds) === bucket,
      ),
    );
    if (bucketValues.length >= MIN_PLAYER_CELL_GAMES) {
      byBucket[bucket] = cellFromValues(bucketValues, input.operator);
    }
  }

  const byLane: Partial<Record<ParlayLane, StatCell>> = {};
  for (const lane of PARLAY_LANES) {
    const laneValues = values(
      input.matches.filter((match) => match.lane === lane),
    );
    if (laneValues.length >= MIN_PLAYER_CELL_GAMES) {
      byLane[lane] = cellFromValues(laneValues, input.operator);
    }
  }

  return {
    overall: cellFromValues(values(input.matches), input.operator),
    byBucket,
    byLane,
  };
}

const PopulationRowSchema = z.looseObject({
  lane: z.string().nullable(),
  bucket: z.union([z.bigint(), z.number()]).transform(Number).nullable(),
  n: z.union([z.bigint(), z.number()]).transform(Number),
});

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

function parseLane(value: string | null): ParlayLane | undefined {
  return PARLAY_LANES.find((lane) => lane === value);
}

function parseBucket(value: number | null): DurationBucket | undefined {
  return DURATION_BUCKETS.find((bucket) => bucket === value);
}

/**
 * Population quantiles for one column, in a single grouped scan.
 *
 * GROUPING SETS produces the overall row, the per-bucket rows, and the
 * lane-by-bucket cross together; a NULL grouping key marks the wider rollup.
 * The column name comes from the reviewed field map, never from model output.
 */
export async function fetchPopulationFrame(options: {
  column: keyof MatchLakeRow;
  operator: ParlayOperator;
  queue: ParlayHistoryQueue;
  lakeDir?: string;
  timeoutMs?: number;
}): Promise<PopulationFrame | undefined> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildMatchesSource(files, {
    sql:
      "queue = ? AND team_position <> '' AND end_of_game_result = 'GameComplete' AND game_duration_seconds >= " +
      REMAKE_MAX_DURATION_SECONDS.toString() +
      " AND early_surrendered = false AND team_early_surrendered = false",
    params: [scalarParam(options.queue)],
  });
  if (source === undefined) {
    return undefined;
  }

  const rows = await withDuckDBConnection(
    async (session) => {
      const sql =
        `WITH raw AS (SELECT * FROM (${source.sql})), valid_matches AS (` +
        `SELECT match_id FROM raw GROUP BY match_id ` +
        `HAVING count(*) = 10 AND count(DISTINCT team_id) = 2 ` +
        `AND count(*) FILTER (WHERE team_id = 100) = 5 ` +
        `AND count(*) FILTER (WHERE team_id = 200) = 5), ` +
        `base AS (SELECT team_position AS lane, ` +
        `CASE WHEN game_duration_seconds < 900 THEN 10 ` +
        `WHEN game_duration_seconds < 1500 THEN 20 ` +
        `WHEN game_duration_seconds < 2100 THEN 30 ` +
        `WHEN game_duration_seconds < 2700 THEN 40 ELSE 50 END AS bucket, ` +
        `${options.column} FROM raw ` +
        `WHERE match_id IN (SELECT match_id FROM valid_matches)) ` +
        `SELECT lane, bucket, count(*)::BIGINT AS n, list(${options.column}) AS values ` +
        `FROM base GROUP BY GROUPING SETS ((lane, bucket), (bucket), ())`;
      return await session.run(sql, bindParams(session, source.params));
    },
    { timeoutMs: options.timeoutMs ?? 5000 },
  );

  let overall: StatCell | undefined;
  const byBucket: Partial<Record<DurationBucket, StatCell>> = {};
  const byLaneAndBucket: Partial<
    Record<ParlayLane, Partial<Record<DurationBucket, StatCell>>>
  > = {};

  for (const row of rows) {
    const parsed = PopulationRowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const values = z
      .array(z.union([z.bigint(), z.number()]).transform(Number))
      .safeParse(parsed.data["values"]);
    if (!values.success || values.data.length !== parsed.data.n) {
      continue;
    }
    const cell = cellFromValues(values.data, options.operator);
    const lane = parseLane(parsed.data.lane);
    const bucket = parseBucket(parsed.data.bucket);

    if (lane === undefined && bucket === undefined) {
      overall = cell;
    } else if (lane === undefined && bucket !== undefined) {
      byBucket[bucket] = cell;
    } else if (lane !== undefined && bucket !== undefined) {
      const lanes = byLaneAndBucket[lane] ?? {};
      lanes[bucket] = cell;
      byLaneAndBucket[lane] = lanes;
    }
  }

  if (overall === undefined) {
    return undefined;
  }
  return { overall, byBucket, byLaneAndBucket };
}

/**
 * The statistics pass two chooses thresholds against, for exactly the legs pass
 * one proposed.
 *
 * Only legs that take a number appear: a team-win leg has nothing to choose.
 * Population frames are fetched only for participant fields, because the
 * population frame aggregates participant rows — a team or opponent total is a
 * different quantity and reporting the participant distribution beside it would
 * invite a threshold off the wrong scale.
 */
export async function buildProposalStatistics(input: {
  legs: readonly {
    index: number;
    subjectKey: string | null;
    subjectPuuid: string | null;
    column: keyof MatchLakeRow;
    operator: ParlayOperator;
    scope: "player" | "team" | "opponent";
    label: string;
  }[];
  history: ReadonlyMap<string, readonly ParlayHistoryMatch[]>;
  queue: ParlayHistoryQueue;
  lakeDir?: string;
  timeoutMs?: number;
}): Promise<unknown[]> {
  const populationCache = new Map<string, PopulationFrame | undefined>();
  const out: unknown[] = [];

  for (const leg of input.legs) {
    const matches =
      leg.subjectPuuid === null
        ? []
        : (input.history.get(leg.subjectPuuid) ?? []);
    const player = buildPlayerFrame({
      matches,
      column: leg.column,
      operator: leg.operator,
      team: leg.scope === "team",
      opponent: leg.scope === "opponent",
    });

    let population: PopulationFrame | undefined;
    if (leg.scope === "player") {
      const cacheKey = [leg.column, leg.operator].join("|");
      if (!populationCache.has(cacheKey)) {
        populationCache.set(
          cacheKey,
          await fetchPopulationFrame({
            column: leg.column,
            operator: leg.operator,
            queue: input.queue,
            ...(input.lakeDir === undefined ? {} : { lakeDir: input.lakeDir }),
            ...(input.timeoutMs === undefined
              ? {}
              : { timeoutMs: input.timeoutMs }),
          }),
        );
      }
      population = populationCache.get(cacheKey);
    }

    out.push({
      condition: leg.index,
      describes: leg.label,
      subject: leg.subjectKey,
      operator: leg.operator,
      player,
      ...(population === undefined ? {} : { population }),
    });
  }
  return out;
}

export type StatLeg = {
  index: number;
  subjectKey: string | null;
  subjectPuuid: string | null;
  column: keyof MatchLakeRow;
  operator: ParlayOperator;
  scope: "player" | "team" | "opponent";
  label: string;
};

/**
 * Which measured distribution each proposed leg needs.
 *
 * A leg whose column cannot be resolved is dropped from the statistics rather
 * than defaulted: pass two then has nothing to choose against for it, and
 * pricing refuses the parlay outright, which is the intended fail-closed path.
 */
export function statLegsForProposal(
  proposal: ModelParlayProposal,
  subjects: readonly ParlaySubject[],
): StatLeg[] {
  const puuidFor = (key: string | null): string | null =>
    subjects.find((subject) => subject.key === key)?.puuid ?? null;
  const anchor = subjects[0]?.puuid ?? null;

  return proposal.conditions.flatMap((condition, index): StatLeg[] => {
    const operator = condition.operator;
    if (operator === null) {
      return [];
    }
    if (condition.kind === "participant_numeric") {
      const field = condition.participantNumericField;
      const column = field === null ? null : PARLAY_HISTORY_COLUMNS[field];
      return column === null || field === null
        ? []
        : [
            {
              index,
              subjectKey: condition.subject,
              subjectPuuid: puuidFor(condition.subject),
              column,
              operator,
              scope: "player" as const,
              label: field,
            },
          ];
    }
    if (condition.kind === "team_objective_kills") {
      const objective = condition.objective;
      const column =
        objective === null ? null : TEAM_OBJECTIVE_HISTORY_COLUMNS[objective];
      return column === null || objective === null
        ? []
        : [
            {
              index,
              subjectKey: null,
              subjectPuuid: anchor,
              column,
              operator,
              scope: "team" as const,
              label: `selected team ${objective}`,
            },
          ];
    }
    if (condition.kind === "opponent_team_pings") {
      const field = condition.opponentPingField;
      return field === null
        ? []
        : [
            {
              index,
              subjectKey: null,
              subjectPuuid: anchor,
              column: OPPONENT_PING_HISTORY_COLUMNS[field],
              operator,
              scope: "opponent" as const,
              label: `enemy team ${field}`,
            },
          ];
    }
    if (condition.kind === "match_numeric") {
      return condition.matchNumericField === "gameDuration"
        ? [
            {
              index,
              subjectKey: null,
              subjectPuuid: anchor,
              column: "game_duration_seconds",
              operator,
              scope: "player" as const,
              label: "game duration in seconds",
            },
          ]
        : [];
    }
    return [];
  });
}
