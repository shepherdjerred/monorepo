import { z } from "zod";
import { REMAKE_MAX_DURATION_SECONDS } from "#src/betting/constants.ts";
import {
  OPPONENT_PING_HISTORY_COLUMNS,
  PARLAY_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import type { MatchLakeRow } from "#src/report-lake/schema.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";

/**
 * Recorded history behind a parlay, in the shape both threshold selection and
 * pricing need.
 *
 * One fetch serves both: the stat frames shown to the model are summaries of
 * these rows, and the price is these same rows replayed against the finished
 * leg set. Deriving them from one snapshot is what stops a parlay being priced
 * against a different history than it was written against.
 *
 * History is kept in the queue being priced. A solo market must not inherit
 * flex wins (or vice versa), especially when the parlay contains a result leg.
 */

/** Queues a parlay may be generated for, and therefore priced against. */
export const PARLAY_HISTORY_QUEUES = ["solo", "flex"] as const;
export type ParlayHistoryQueue = (typeof PARLAY_HISTORY_QUEUES)[number];

/**
 * How many settled matches back the window reaches.
 *
 * 30 (the old prompt's limit) cannot survive being split by duration: the
 * 25-35m bucket holds ~54% of games and the tails ~3% each, so the outer
 * buckets landed on one or two games. 150 puts every bucket that matters into
 * double digits while staying inside a single fast query.
 */
export const PARLAY_HISTORY_LIMIT = 150;

/** Over-fetch so void matches dropped in JS do not shrink the usable window. */
const HISTORY_FETCH_MULTIPLIER = 2;

export const PARLAY_HISTORY_TIMEOUT_MS = 5000;

const LakeNumberSchema = z.union([z.bigint(), z.number()]).transform(Number);

const HistoryParticipantSchema = z.looseObject({
  match_id: z.string(),
  puuid: z.string(),
  team_id: LakeNumberSchema,
  win: z.boolean(),
  team_position: z.string(),
  game_duration_seconds: LakeNumberSchema,
  game_creation_ms: LakeNumberSchema,
  end_of_game_result: z.string(),
  early_surrendered: z.boolean(),
  team_early_surrendered: z.boolean(),
});

export type ParlayHistoryMatch = {
  matchId: string;
  createdAtMs: number;
  durationSeconds: number;
  /** The subject's own outcome and position in that match. */
  win: boolean;
  lane: string;
  /** Column name -> the subject's value. */
  values: ReadonlyMap<string, number>;
  /** Column name -> the sum across the subject's team, for objective legs. */
  teamValues: ReadonlyMap<string, number>;
  /** Column name -> the sum across the five opponents, for opponent legs. */
  opponentValues: ReadonlyMap<string, number>;
};

export type ParlayHistory = ReadonlyMap<string, readonly ParlayHistoryMatch[]>;

/** Columns every history fetch pulls, derived from the reviewed field map. */
function historyColumns(): (keyof MatchLakeRow)[] {
  const columns = new Set<keyof MatchLakeRow>();
  for (const column of Object.values(PARLAY_HISTORY_COLUMNS)) {
    if (column !== null) {
      columns.add(column);
    }
  }
  for (const column of Object.values(OPPONENT_PING_HISTORY_COLUMNS)) {
    columns.add(column);
  }
  return [...columns];
}

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

const LooseRowSchema = z.record(z.string(), z.unknown());

function numeric(row: unknown, column: string): number | undefined {
  const parsed = LooseRowSchema.safeParse(row);
  if (!parsed.success) {
    return undefined;
  }
  const value = LakeNumberSchema.safeParse(parsed.data[column]);
  return value.success ? value.data : undefined;
}

/**
 * Matches that could never have settled, and so must not sit in a price's
 * denominator.
 *
 * This mirrors classifyMatchForBetting exactly rather than approximately: the
 * same three conditions, against the same values. A near-match would bias every
 * leg's hit rate downward by counting games that would have been refunded.
 */
function isVoidMatch(participants: readonly unknown[]): boolean {
  const first = participants[0];
  if (first === undefined) {
    return true;
  }
  const parsed = HistoryParticipantSchema.safeParse(first);
  if (!parsed.success) {
    return true;
  }
  if (parsed.data.end_of_game_result !== "GameComplete") {
    return true;
  }
  if (parsed.data.game_duration_seconds < REMAKE_MAX_DURATION_SECONDS) {
    return true;
  }
  return participants.some((participant) => {
    const row = HistoryParticipantSchema.safeParse(participant);
    return (
      row.success &&
      (row.data.early_surrendered || row.data.team_early_surrendered)
    );
  });
}

function sumColumn(input: {
  participants: readonly unknown[];
  subjectTeamId: number;
  column: keyof MatchLakeRow;
  sameTeam: boolean;
}): number | undefined {
  let total = 0;
  for (const participant of input.participants) {
    const parsed = HistoryParticipantSchema.safeParse(participant);
    const value = numeric(participant, input.column);
    if (value === undefined || !parsed.success) {
      return undefined;
    }
    if ((parsed.data.team_id === input.subjectTeamId) === input.sameTeam) {
      total += value;
    }
  }
  return total;
}

function buildHistoryMatch(input: {
  matchId: string;
  puuid: string;
  participants: readonly unknown[];
  columns: readonly (keyof MatchLakeRow)[];
}): ParlayHistoryMatch | undefined {
  const subjectRow = input.participants.find((participant) => {
    const parsed = HistoryParticipantSchema.safeParse(participant);
    return parsed.success && parsed.data.puuid === input.puuid;
  });
  if (subjectRow === undefined) {
    return undefined;
  }
  const subject = HistoryParticipantSchema.parse(subjectRow);
  const values = new Map<string, number>();
  const teamValues = new Map<string, number>();
  const opponentValues = new Map<string, number>();
  for (const column of input.columns) {
    const subjectValue = numeric(subjectRow, column);
    const teamValue = sumColumn({
      participants: input.participants,
      subjectTeamId: subject.team_id,
      column,
      sameTeam: true,
    });
    const opponentValue = sumColumn({
      participants: input.participants,
      subjectTeamId: subject.team_id,
      column,
      sameTeam: false,
    });
    if (
      subjectValue === undefined ||
      teamValue === undefined ||
      opponentValue === undefined
    ) {
      return undefined;
    }
    values.set(column, subjectValue);
    teamValues.set(column, teamValue);
    opponentValues.set(column, opponentValue);
  }
  return {
    matchId: input.matchId,
    createdAtMs: subject.game_creation_ms,
    durationSeconds: subject.game_duration_seconds,
    win: subject.win,
    lane: subject.team_position,
    values,
    teamValues,
    opponentValues,
  };
}

/**
 * Up to PARLAY_HISTORY_LIMIT settled matches per subject, each carrying the
 * subject's own values and their team's summed values.
 *
 * Full rosters are fetched because team objective counts are reconstructed from
 * the participant column that recorded who landed the blow — the lake stores
 * participants, not info.teams[].objectives.
 */
export async function fetchParlayHistory(options: {
  puuids: readonly string[];
  excludeMatchId: string;
  queue: (typeof PARLAY_HISTORY_QUEUES)[number];
  lakeDir?: string;
  limit?: number;
  timeoutMs?: number;
}): Promise<ParlayHistory> {
  const puuids = [...new Set(options.puuids)];
  if (puuids.length === 0) {
    return new Map();
  }
  const limit = options.limit ?? PARLAY_HISTORY_LIMIT;
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const columns = historyColumns();
  const columnList = columns.join(", ");

  const subjectSource = buildMatchesSource(files, {
    sql: "puuid IN (SELECT unnest(?)) AND match_id <> ? AND queue = ?",
    params: [
      listParam(puuids),
      scalarParam(options.excludeMatchId),
      scalarParam(options.queue),
    ],
  });
  if (subjectSource === undefined) {
    return new Map();
  }

  const connectionOptions = {
    timeoutMs: options.timeoutMs ?? PARLAY_HISTORY_TIMEOUT_MS,
  };

  const selected = await withDuckDBConnection(async (session) => {
    const sql =
      `WITH ranked AS (SELECT puuid, match_id, ` +
      `row_number() OVER (PARTITION BY puuid ORDER BY game_creation_at DESC) AS rk ` +
      `FROM (${subjectSource.sql})) ` +
      `SELECT puuid, match_id FROM ranked WHERE rk <= ?`;
    const rows = await session.run(
      sql,
      bindParams(session, [
        ...subjectSource.params,
        scalarParam(limit * HISTORY_FETCH_MULTIPLIER),
      ]),
    );
    return rows.map((row) =>
      z.object({ puuid: z.string(), match_id: z.string() }).parse(row),
    );
  }, connectionOptions);

  const matchIds = [...new Set(selected.map((row) => row.match_id))];
  if (matchIds.length === 0) {
    return new Map();
  }

  const rosterSource = buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  });
  if (rosterSource === undefined) {
    return new Map();
  }

  const roster = await withDuckDBConnection(async (session) => {
    const sql =
      `SELECT match_id, puuid, team_id, win, team_position, ` +
      `game_duration_seconds, end_of_game_result, early_surrendered, ` +
      `team_early_surrendered, ` +
      `epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ${columnList} ` +
      `FROM (${rosterSource.sql})`;
    return await session.run(sql, bindParams(session, rosterSource.params));
  }, connectionOptions);

  const byMatch = new Map<string, unknown[]>();
  for (const row of roster) {
    const parsed = HistoryParticipantSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const bucket = byMatch.get(parsed.data.match_id) ?? [];
    bucket.push(row);
    byMatch.set(parsed.data.match_id, bucket);
  }

  const wanted = new Map<string, Set<string>>();
  for (const row of selected) {
    const bucket = wanted.get(row.puuid) ?? new Set<string>();
    bucket.add(row.match_id);
    wanted.set(row.puuid, bucket);
  }

  const history = new Map<string, ParlayHistoryMatch[]>();
  for (const puuid of puuids) {
    const matches: ParlayHistoryMatch[] = [];
    for (const matchId of wanted.get(puuid) ?? new Set<string>()) {
      const participants = byMatch.get(matchId);
      if (participants === undefined || isVoidMatch(participants)) {
        continue;
      }
      const match = buildHistoryMatch({
        matchId,
        puuid,
        participants,
        columns,
      });
      if (match !== undefined) matches.push(match);
    }
    matches.sort((left, right) => right.createdAtMs - left.createdAtMs);
    history.set(puuid, matches.slice(0, limit));
  }
  return history;
}
