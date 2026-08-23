import { z } from "zod";
import type { QueueType } from "@scout-for-lol/data";
import {
  PARLAY_HISTORY_QUEUES,
  type ParlayHistoryMatch,
} from "#src/betting/parlay-history.ts";
import {
  OPPONENT_PING_HISTORY_COLUMNS,
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import type { ModelParlayProposal } from "#src/betting/parlay-model-schema.ts";
import type { ParlaySubject } from "#src/betting/parlay-criteria.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import type { MatchLakeRow } from "@scout-for-lol/data";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
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
const QUANTILE_PROBABILITIES = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

export type ParlayOperator = "gte" | "lte";

export type StatCell = {
  n: number;
  thresholds: Record<HitRate, number>;
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

function quantile(sorted: readonly number[], probability: number): number {
  const first = sorted[0];
  if (first === undefined) {
    return 0;
  }
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? first;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

/**
 * Which quantile produces a given hit rate for a given operator.
 *
 * For `gte`, "lands 70% of the time" is the 30th percentile — 70% of games sit
 * at or above it. For `lte` it is the 70th. Getting this backwards silently
 * inverts every threshold, which is exactly why it lives in one function.
 */
function probabilityForHitRate(
  rate: HitRate,
  operator: ParlayOperator,
): number {
  const fraction = rate / 100;
  return operator === "gte" ? 1 - fraction : fraction;
}

function cellFromValues(
  values: readonly number[],
  operator: ParlayOperator,
): StatCell {
  const sorted = [...values].sort((left, right) => left - right);
  const thresholds = Object.fromEntries(
    HIT_RATES.map((rate) => [
      rate,
      Math.round(quantile(sorted, probabilityForHitRate(rate, operator))),
    ]),
  );
  return {
    n: sorted.length,
    thresholds: z.record(z.coerce.number(), z.number()).parse(thresholds),
  };
}

function cellFromQuantiles(
  n: number,
  quantiles: Record<number, number>,
  operator: ParlayOperator,
): StatCell {
  const thresholds = Object.fromEntries(
    HIT_RATES.map((rate) => {
      const probability = probabilityForHitRate(rate, operator);
      return [rate, Math.round(quantiles[probability] ?? 0)];
    }),
  );
  return {
    n,
    thresholds: z.record(z.coerce.number(), z.number()).parse(thresholds),
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
  const read = (match: ParlayHistoryMatch): number => {
    if (input.column === "game_duration_seconds") {
      return match.durationSeconds;
    }
    const source =
      input.opponent === true
        ? match.opponentValues
        : input.team
          ? match.teamValues
          : match.values;
    return source.get(input.column) ?? 0;
  };

  const byBucket: Partial<Record<DurationBucket, StatCell>> = {};
  for (const bucket of DURATION_BUCKETS) {
    const values = input.matches
      .filter((match) => durationBucket(match.durationSeconds) === bucket)
      .map((match) => read(match));
    if (values.length >= MIN_PLAYER_CELL_GAMES) {
      byBucket[bucket] = cellFromValues(values, input.operator);
    }
  }

  const byLane: Partial<Record<ParlayLane, StatCell>> = {};
  for (const lane of PARLAY_LANES) {
    const values = input.matches
      .filter((match) => match.lane === lane)
      .map((match) => read(match));
    if (values.length >= MIN_PLAYER_CELL_GAMES) {
      byLane[lane] = cellFromValues(values, input.operator);
    }
  }

  return {
    overall: cellFromValues(
      input.matches.map((match) => read(match)),
      input.operator,
    ),
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

function quantileAlias(index: number): string {
  return `q${index.toString()}`;
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
  queueType?: Extract<QueueType, "solo" | "flex">;
  lakeDir?: string;
  timeoutMs?: number;
}): Promise<PopulationFrame | undefined> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildMatchesSource(files, {
    sql:
      options.queueType === undefined
        ? "queue IN (SELECT unnest(?)) AND team_position <> '' AND end_of_game_result = 'GameComplete' AND game_duration_seconds >= 300"
        : "queue = ? AND team_position <> '' AND end_of_game_result = 'GameComplete' AND game_duration_seconds >= 300",
    params:
      options.queueType === undefined
        ? [listParam([...PARLAY_HISTORY_QUEUES])]
        : [{ kind: "scalar", value: options.queueType }],
  });
  if (source === undefined) {
    return undefined;
  }

  const quantileSelect = QUANTILE_PROBABILITIES.map(
    (probability, index) =>
      `quantile_cont(${options.column}, ${probability.toString()}) AS ${quantileAlias(index)}`,
  ).join(", ");

  const rows = await withDuckDBConnection(
    async (session) => {
      const sql =
        `WITH base AS (SELECT team_position AS lane, ` +
        `CASE WHEN game_duration_seconds < 900 THEN 10 ` +
        `WHEN game_duration_seconds < 1500 THEN 20 ` +
        `WHEN game_duration_seconds < 2100 THEN 30 ` +
        `WHEN game_duration_seconds < 2700 THEN 40 ELSE 50 END AS bucket, ` +
        `${options.column} FROM (${source.sql})) ` +
        `SELECT lane, bucket, count(*)::BIGINT AS n, ${quantileSelect} ` +
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
    const quantiles: Record<number, number> = {};
    for (const [index, probability] of QUANTILE_PROBABILITIES.entries()) {
      const value = z
        .union([z.bigint(), z.number()])
        .transform(Number)
        .safeParse(parsed.data[quantileAlias(index)]);
      quantiles[probability] = value.success ? value.data : 0;
    }
    const cell = cellFromQuantiles(parsed.data.n, quantiles, options.operator);
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
  queueType?: Extract<QueueType, "solo" | "flex">;
  lakeDir?: string;
  timeoutMs?: number;
  deadline?: AbortSignal;
  deadlineAt?: number;
}): Promise<unknown[]> {
  const populationCache = new Map<string, PopulationFrame | undefined>();
  const out: unknown[] = [];

  for (const leg of input.legs) {
    input.deadline?.throwIfAborted();
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
        const remainingMs =
          input.deadlineAt === undefined
            ? undefined
            : Math.max(1, input.deadlineAt - Date.now());
        populationCache.set(
          cacheKey,
          await fetchPopulationFrame({
            column: leg.column,
            operator: leg.operator,
            ...(input.queueType === undefined
              ? {}
              : { queueType: input.queueType }),
            ...(input.lakeDir === undefined ? {} : { lakeDir: input.lakeDir }),
            ...(remainingMs === undefined && input.timeoutMs === undefined
              ? {}
              : {
                  timeoutMs: Math.min(
                    input.timeoutMs ?? 5000,
                    remainingMs ?? Number.POSITIVE_INFINITY,
                  ),
                }),
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
  operator: "gte" | "lte";
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
    const operator = condition.operator === "lte" ? "lte" : "gte";
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
      return [
        {
          index,
          subjectKey: null,
          subjectPuuid: anchor,
          column: "game_duration_seconds",
          operator,
          scope: "player" as const,
          label: "game duration",
        },
      ];
    }
    return [];
  });
}
