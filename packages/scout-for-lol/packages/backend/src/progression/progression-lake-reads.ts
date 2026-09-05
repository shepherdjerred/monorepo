import { z } from "zod";
import {
  QueueTypeSchema,
  type HallEligibleMatch,
  type HallRecordMatch,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  buildTimelineEventsSource,
  buildTimelineEventParticipantsSource,
  buildTimelineCoverageSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const ProgressionMatchRowSchema = z.strictObject({
  match_id: z.string(),
  game_end_at: z.string(),
  game_end_ms: LakeIntSchema,
  game_duration_seconds: LakeIntSchema,
  queue: QueueTypeSchema,
  end_of_game_result: z.string().nullable(),
  early_surrendered: z.boolean(),
  puuid: z.string(),
  champion_id: LakeIntSchema,
  champion_name: z.string(),
  team_position: z.string(),
  win: z.boolean(),
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  creep_score: LakeIntSchema,
  gold_earned: LakeIntSchema,
  total_damage_dealt_to_champions: LakeIntSchema,
  total_damage_taken: LakeIntSchema,
  damage_self_mitigated: LakeIntSchema,
  total_heals_on_teammates: LakeIntSchema,
  vision_score: LakeIntSchema,
  wards_killed: LakeIntSchema,
  damage_dealt_to_objectives: LakeIntSchema,
  damage_dealt_to_turrets: LakeIntSchema,
  time_ccing_others: LakeIntSchema,
  longest_time_spent_living: LakeIntSchema,
  total_time_spent_dead: LakeIntSchema,
  largest_multi_kill: LakeIntSchema,
  timeline_complete: z.boolean(),
});

export type ProgressionMatchRow = z.infer<typeof ProgressionMatchRowSchema> &
  HallEligibleMatch &
  HallRecordMatch;

export type ProgressionMatchCursor = {
  readonly gameEndMs: number;
  readonly matchId: string;
  readonly puuid: string;
};

const MATCH_COLUMNS = [
  "m.match_id",
  "strftime(m.game_end_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS game_end_at",
  "epoch_ms(m.game_end_at)::BIGINT AS game_end_ms",
  "m.game_duration_seconds",
  "m.queue",
  "m.end_of_game_result",
  "m.early_surrendered",
  "m.puuid",
  "m.champion_id",
  "m.champion_name",
  "m.team_position",
  "m.win",
  "m.kills",
  "m.deaths",
  "m.assists",
  "m.creep_score",
  "m.gold_earned",
  "m.total_damage_dealt_to_champions",
  "m.total_damage_taken",
  "m.damage_self_mitigated",
  "m.total_heals_on_teammates",
  "m.vision_score",
  "m.wards_killed",
  "m.damage_dealt_to_objectives",
  "m.damage_dealt_to_turrets",
  "m.time_ccing_others",
  "m.longest_time_spent_living",
  "m.total_time_spent_dead",
  "m.largest_multi_kill",
].join(", ");

function cursorPredicate(cursor: ProgressionMatchCursor | undefined): {
  readonly sql: string;
  readonly params: ReturnType<typeof scalarParam>[];
} {
  if (cursor === undefined) return { sql: "", params: [] };
  return {
    sql:
      "AND (epoch_ms(game_end_at) > ? OR " +
      "(epoch_ms(game_end_at) = ? AND match_id > ?) OR " +
      "(epoch_ms(game_end_at) = ? AND match_id = ? AND puuid > ?))",
    params: [
      scalarParam(cursor.gameEndMs),
      scalarParam(cursor.gameEndMs),
      scalarParam(cursor.matchId),
      scalarParam(cursor.gameEndMs),
      scalarParam(cursor.matchId),
      scalarParam(cursor.puuid),
    ],
  };
}

const TimelineEventCountRowSchema = z.strictObject({
  match_id: z.string(),
  puuid: z.string(),
  event_type: z.string(),
  event_count: LakeIntSchema,
});

export async function fetchTimelineEventCounts(options: {
  readonly matchPuuids: readonly {
    readonly matchId: string;
    readonly puuid: string;
  }[];
  readonly lakeDir?: string;
}): Promise<
  ReadonlyMap<string, ReadonlyMap<string, Readonly<Record<string, number>>>>
> {
  if (options.matchPuuids.length === 0) return new Map();
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const matchIds = [...new Set(options.matchPuuids.map((row) => row.matchId))];
  const puuids = [...new Set(options.matchPuuids.map((row) => row.puuid))];
  const events = buildTimelineEventsSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  });
  const participants = buildTimelineEventParticipantsSource(files, {
    sql: "match_id IN (SELECT unnest(?)) AND puuid IN (SELECT unnest(?))",
    params: [listParam(matchIds), listParam(puuids)],
  });
  if (events === undefined || participants === undefined) return new Map();
  const rows = await withDuckDBConnection(async (session) => {
    const values = await session.run(
      `SELECT events.match_id, participants.puuid, events.event_type, ` +
        `count(DISTINCT events.event_id)::BIGINT AS event_count ` +
        `FROM (${events.sql}) AS events ` +
        `INNER JOIN (${participants.sql}) AS participants ` +
        `ON participants.match_id = events.match_id ` +
        `AND participants.event_id = events.event_id ` +
        `WHERE participants.puuid IS NOT NULL ` +
        `GROUP BY events.match_id, participants.puuid, events.event_type`,
      bindParams(session, [...events.params, ...participants.params]),
    );
    return values.map((row) => TimelineEventCountRowSchema.parse(row));
  });
  const counts = new Map<string, Map<string, Record<string, number>>>();
  for (const row of rows) {
    const matchCounts = counts.get(row.match_id) ?? new Map();
    const puuidCounts = matchCounts.get(row.puuid) ?? {};
    puuidCounts[row.event_type] = row.event_count;
    matchCounts.set(row.puuid, puuidCounts);
    counts.set(row.match_id, matchCounts);
  }
  return counts;
}

/**
 * Read progression evidence in stable ascending order. The caller-provided
 * PUUIDs are the complete authorization boundary; no global lake scan is
 * exposed through this helper.
 */
export async function fetchProgressionMatches(options: {
  readonly puuids: string[];
  readonly startAt: Date;
  readonly endAt?: Date;
  readonly matchId?: string;
  readonly cursor?: ProgressionMatchCursor;
  readonly limit?: number;
  readonly lakeDir?: string;
}): Promise<ProgressionMatchRow[]> {
  if (options.puuids.length === 0) return [];
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const cursor = cursorPredicate(options.cursor);
  const endClause =
    options.endAt === undefined ? "" : " AND epoch_ms(game_end_at) <= ?";
  const matchClause = options.matchId === undefined ? "" : " AND match_id = ?";
  const source = buildMatchesSource(files, {
    sql:
      "puuid IN (SELECT unnest(?)) AND queue IS NOT NULL AND epoch_ms(game_end_at) >= ?" +
      endClause +
      matchClause +
      ` ${cursor.sql}`,
    params: [
      listParam(options.puuids),
      scalarParam(options.startAt.getTime()),
      ...(options.endAt === undefined
        ? []
        : [scalarParam(options.endAt.getTime())]),
      ...(options.matchId === undefined ? [] : [scalarParam(options.matchId)]),
      ...cursor.params,
    ],
  });
  if (source === undefined) return [];
  const coverage = buildTimelineCoverageSource(files, {
    sql: "match_id IN (SELECT DISTINCT match_id FROM matches_for_progression)",
    params: [],
  });
  const coverageJoin =
    coverage === undefined
      ? "false AS timeline_complete"
      : "c.coverage_state = 'complete' AS timeline_complete";
  const coverageCte =
    coverage === undefined ? "" : `, coverage AS (${coverage.sql})`;
  const coverageJoinSql =
    coverage === undefined
      ? ""
      : " LEFT JOIN coverage c ON c.match_id = m.match_id";
  const limit = Math.floor(options.limit ?? 100_000);
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `WITH matches_for_progression AS (${source.sql})${coverageCte} ` +
        `SELECT ${MATCH_COLUMNS}, ${coverageJoin} ` +
        `FROM matches_for_progression m${coverageJoinSql} ` +
        `ORDER BY m.game_end_at ASC, m.match_id ASC, m.puuid ASC LIMIT ?`,
      bindParams(session, [
        ...source.params,
        ...(coverage?.params ?? []),
        scalarParam(limit),
      ]),
    );
    return rows.map((row) => ProgressionMatchRowSchema.parse(row));
  });
}
