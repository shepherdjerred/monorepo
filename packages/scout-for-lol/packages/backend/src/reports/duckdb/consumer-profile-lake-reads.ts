import { z } from "zod";
import {
  TimelineEventLakeRowSchema,
  TimelineParticipantFrameLakeRowSchema,
  type PlayerProfileGameWindow,
  type QueueType,
  type TimelineEventLakeRow,
  type TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  buildTimelineParticipantFramesSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

async function runSource<T>(options: {
  source: SqlFragment;
  sql: string;
  leadingParams?: BoundParam[];
  trailingParams?: BoundParam[];
  schema: z.ZodType<T>;
}): Promise<T[]> {
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      options.sql,
      bindParams(session, [
        ...(options.leadingParams ?? []),
        ...options.source.params,
        ...(options.trailingParams ?? []),
      ]),
    );
    return rows.map((row) => options.schema.parse(row));
  });
}

function queuePredicate(queues: QueueType[] | undefined): {
  sql: string;
  params: BoundParam[];
} {
  return queues === undefined
    ? { sql: "", params: [] }
    : {
        sql: "queue IN (SELECT unnest(?))",
        params: [listParam(queues)],
      };
}

export type ChampionComparisonEntry = {
  entryKey: string;
  puuids: string[];
};

const ChampionComparisonRowSchema = z.object({
  entry_key: z.string(),
  champion_name: z.string(),
  games: LakeIntSchema,
  wins: LakeIntSchema,
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  creep_score: LakeIntSchema,
  gold_earned: LakeIntSchema,
  vision_score: LakeIntSchema,
  damage_to_champions: LakeIntSchema,
  time_played: LakeIntSchema,
});

export type LakeChampionComparisonRow = z.infer<
  typeof ChampionComparisonRowSchema
>;

export async function fetchChampionComparisons(options: {
  championId: number;
  entries: ChampionComparisonEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[];
  lakeDir?: string;
}): Promise<LakeChampionComparisonRow[]> {
  const pairs = options.entries.flatMap((entry) =>
    entry.puuids.map((puuid) => ({ entryKey: entry.entryKey, puuid })),
  );
  if (pairs.length === 0) return [];
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const allPuuids = [...new Set(pairs.map((pair) => pair.puuid))];
  const queues = queuePredicate(options.queues);
  const source = buildMatchesSource(files, {
    sql: ["puuid IN (SELECT unnest(?))", "champion_id = ?", queues.sql]
      .filter((part) => part.length > 0)
      .join(" AND "),
    params: [
      listParam(allPuuids),
      scalarParam(options.championId),
      ...queues.params,
    ],
  });
  if (source === undefined) return [];
  const requestedSql = pairs.map(() => "(?, ?)").join(", ");
  const requestedParams = pairs.flatMap((pair) => [
    scalarParam(pair.entryKey),
    scalarParam(pair.puuid),
  ]);
  const windowClause =
    options.games === "all" ? "" : "WHERE player_game_rank <= ?";
  const windowParams =
    options.games === "all" ? [] : [scalarParam(options.games)];
  return await runSource({
    source,
    leadingParams: requestedParams,
    trailingParams: windowParams,
    sql:
      `WITH requested(entry_key, puuid) AS (VALUES ${requestedSql}), ` +
      `deduped AS (` +
      `SELECT requested.entry_key, matches.* FROM (${source.sql}) AS matches ` +
      `INNER JOIN requested ON requested.puuid = matches.puuid ` +
      `QUALIFY row_number() OVER (` +
      `PARTITION BY requested.entry_key, matches.match_id ORDER BY matches.puuid) = 1), ` +
      `ranked AS (` +
      `SELECT *, row_number() OVER (` +
      `PARTITION BY entry_key ORDER BY game_creation_at DESC, match_id DESC) AS player_game_rank ` +
      `FROM deduped), scoped AS (SELECT * FROM ranked ${windowClause}) ` +
      `SELECT entry_key, min(champion_name) AS champion_name, count(*)::BIGINT AS games, ` +
      `sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
      `sum(kills)::BIGINT AS kills, sum(deaths)::BIGINT AS deaths, ` +
      `sum(assists)::BIGINT AS assists, sum(creep_score)::BIGINT AS creep_score, ` +
      `sum(gold_earned)::BIGINT AS gold_earned, sum(vision_score)::BIGINT AS vision_score, ` +
      `sum(total_damage_dealt_to_champions)::BIGINT AS damage_to_champions, ` +
      `sum(time_played)::BIGINT AS time_played FROM scoped GROUP BY entry_key`,
    schema: ChampionComparisonRowSchema,
  });
}

const MatchParticipantRowSchema = z.object({
  match_id: z.string(),
  game_creation_ms: LakeIntSchema,
  game_duration_seconds: LakeIntSchema,
  queue: z.string().nullable(),
  queue_id: LakeIntSchema,
  game_mode: z.string(),
  game_type: z.string(),
  game_version: z.string(),
  map_id: LakeIntSchema,
  puuid: z.string(),
  participant_id: LakeIntSchema,
  team_id: LakeIntSchema,
  riot_id_game_name: z.string().nullable(),
  riot_id_tagline: z.string(),
  champion_id: LakeIntSchema,
  champion_name: z.string(),
  team_position: z.string(),
  win: z.boolean(),
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  creep_score: LakeIntSchema,
  gold_earned: LakeIntSchema,
  vision_score: LakeIntSchema,
  total_damage_dealt_to_champions: LakeIntSchema,
  turret_kills: LakeIntSchema,
  inhibitor_kills: LakeIntSchema,
  baron_kills: LakeIntSchema,
  dragon_kills: LakeIntSchema,
});

export type LakeMatchParticipantRow = z.infer<typeof MatchParticipantRowSchema>;

export async function fetchFullMatch(options: {
  matchId: string;
  lakeDir?: string;
}): Promise<LakeMatchParticipantRow[]> {
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const source = buildMatchesSource(files, {
    sql: "match_id = ?",
    params: [scalarParam(options.matchId)],
  });
  if (source === undefined) return [];
  return await runSource({
    source,
    sql:
      `SELECT match_id, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
      `game_duration_seconds, queue, queue_id, game_mode, game_type, game_version, map_id, ` +
      `puuid, participant_id, team_id, riot_id_game_name, riot_id_tagline, ` +
      `champion_id, champion_name, team_position, win, kills, deaths, assists, creep_score, ` +
      `gold_earned, vision_score, total_damage_dealt_to_champions, turret_kills, ` +
      `inhibitor_kills, baron_kills, dragon_kills FROM (${source.sql}) ` +
      `ORDER BY team_id, participant_id`,
    schema: MatchParticipantRowSchema,
  });
}

const TimelineCoverageRowSchema = z.object({
  coverage_state: z.literal("complete"),
  data_version: z.string(),
  frame_interval_ms: LakeIntSchema,
  frame_count: LakeIntSchema,
  event_count: LakeIntSchema,
  participant_count: LakeIntSchema,
  first_frame_timestamp_ms: LakeIntSchema.nullable(),
  last_frame_timestamp_ms: LakeIntSchema.nullable(),
});

export type LakeTimelineCoverage = z.infer<typeof TimelineCoverageRowSchema>;

export async function fetchTimelineCoverage(options: {
  matchId: string;
  lakeDir?: string;
}): Promise<LakeTimelineCoverage | null> {
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const source = buildTimelineCoverageSource(files, {
    sql: "match_id = ?",
    params: [scalarParam(options.matchId)],
  });
  if (source === undefined) return null;
  const rows = await runSource({
    source,
    sql:
      `SELECT coverage_state, data_version, frame_interval_ms, frame_count, event_count, ` +
      `participant_count, first_frame_timestamp_ms, last_frame_timestamp_ms ` +
      `FROM (${source.sql}) LIMIT 1`,
    schema: TimelineCoverageRowSchema,
  });
  return rows[0] ?? null;
}

const TimelineEventReadSchema = TimelineEventLakeRowSchema.omit({
  match_id: true,
  month: true,
  observed_at: true,
}).extend({
  frame_index: LakeIntSchema,
  event_index: LakeIntSchema,
  frame_timestamp_ms: LakeIntSchema,
  event_timestamp_ms: LakeIntSchema,
  participant_id: LakeIntSchema.nullable(),
  killer_id: LakeIntSchema.nullable(),
  victim_id: LakeIntSchema.nullable(),
  creator_id: LakeIntSchema.nullable(),
  team_id: LakeIntSchema.nullable(),
  killer_team_id: LakeIntSchema.nullable(),
  item_id: LakeIntSchema.nullable(),
  after_id: LakeIntSchema.nullable(),
  before_id: LakeIntSchema.nullable(),
  skill_slot: LakeIntSchema.nullable(),
  level: LakeIntSchema.nullable(),
  bounty: LakeIntSchema.nullable(),
  shutdown_bounty: LakeIntSchema.nullable(),
  kill_streak_length: LakeIntSchema.nullable(),
  gold_gain: LakeIntSchema.nullable(),
  position_x: LakeIntSchema.nullable(),
  position_y: LakeIntSchema.nullable(),
  winning_team_id: LakeIntSchema.nullable(),
  real_timestamp_ms: LakeIntSchema.nullable(),
});

export type TimelineEventRead = Omit<
  TimelineEventLakeRow,
  "match_id" | "month" | "observed_at"
>;

const TIMELINE_EVENT_COLUMNS = Object.keys(TimelineEventReadSchema.shape).join(
  ", ",
);

export async function fetchTimelineEventPage(options: {
  matchId: string;
  offset: number;
  limit: number;
  eventTypes?: string[];
  participantIds?: number[];
  lakeDir?: string;
}): Promise<TimelineEventRead[]> {
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const clauses = ["match_id = ?"];
  const params: BoundParam[] = [scalarParam(options.matchId)];
  if (options.eventTypes !== undefined) {
    clauses.push("event_type IN (SELECT unnest(?))");
    params.push(listParam(options.eventTypes));
  }
  const source = buildTimelineEventsSource(files, {
    sql: clauses.join(" AND "),
    params,
  });
  if (source === undefined) return [];
  const participantSource =
    options.participantIds === undefined
      ? undefined
      : buildTimelineEventParticipantsSource(files, {
          sql: "match_id = ? AND participant_id IN (SELECT unnest(?))",
          params: [
            scalarParam(options.matchId),
            listParam(options.participantIds),
          ],
        });
  if (participantSource === undefined && options.participantIds !== undefined) {
    return [];
  }
  const participantClause =
    participantSource === undefined
      ? ""
      : `WHERE event_id IN (SELECT event_id FROM (${participantSource.sql}))`;
  return await runSource({
    source,
    trailingParams: [
      ...(participantSource?.params ?? []),
      scalarParam(Math.floor(options.limit)),
      scalarParam(Math.floor(options.offset)),
    ],
    sql:
      `SELECT ${TIMELINE_EVENT_COLUMNS} FROM (${source.sql}) ${participantClause} ` +
      `ORDER BY event_timestamp_ms, frame_index, event_index, event_id LIMIT ? OFFSET ?`,
    schema: TimelineEventReadSchema,
  });
}

const TimelineFrameReadSchema = TimelineParticipantFrameLakeRowSchema.omit({
  match_id: true,
  month: true,
  observed_at: true,
}).extend({
  frame_index: LakeIntSchema,
  frame_timestamp_ms: LakeIntSchema,
  participant_id: LakeIntSchema,
  position_x: LakeIntSchema,
  position_y: LakeIntSchema,
  current_gold: LakeIntSchema,
  total_gold: LakeIntSchema,
  gold_per_second: LakeIntSchema,
  minions_killed: LakeIntSchema,
  jungle_minions_killed: LakeIntSchema,
  level: LakeIntSchema,
  xp: LakeIntSchema,
});

export type TimelineFrameRead = Omit<
  TimelineParticipantFrameLakeRow,
  "match_id" | "month" | "observed_at"
>;

const TIMELINE_FRAME_COLUMNS = Object.keys(TimelineFrameReadSchema.shape).join(
  ", ",
);

export async function fetchTimelineFramePage(options: {
  matchId: string;
  offset: number;
  limit: number;
  participantIds?: number[];
  lakeDir?: string;
}): Promise<TimelineFrameRead[]> {
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const clauses = ["match_id = ?"];
  const params: BoundParam[] = [scalarParam(options.matchId)];
  if (options.participantIds !== undefined) {
    clauses.push("participant_id IN (SELECT unnest(?))");
    params.push(listParam(options.participantIds));
  }
  const source = buildTimelineParticipantFramesSource(files, {
    sql: clauses.join(" AND "),
    params,
  });
  if (source === undefined) return [];
  return await runSource({
    source,
    trailingParams: [
      scalarParam(Math.floor(options.limit)),
      scalarParam(Math.floor(options.offset)),
    ],
    sql:
      `SELECT ${TIMELINE_FRAME_COLUMNS} FROM (${source.sql}) ` +
      `ORDER BY frame_timestamp_ms, participant_id LIMIT ? OFFSET ?`,
    schema: TimelineFrameReadSchema,
  });
}

const TimelineChartFrameSchema = z.object({
  frame_timestamp_ms: LakeIntSchema,
  participant_id: LakeIntSchema,
  total_gold: LakeIntSchema,
  xp: LakeIntSchema,
});

export type TimelineChartFrame = z.infer<typeof TimelineChartFrameSchema>;

export async function fetchTimelineChartFrames(options: {
  matchId: string;
  lakeDir?: string;
}): Promise<TimelineChartFrame[]> {
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const source = buildTimelineParticipantFramesSource(files, {
    sql: "match_id = ?",
    params: [scalarParam(options.matchId)],
  });
  if (source === undefined) return [];
  return await runSource({
    source,
    sql:
      `SELECT frame_timestamp_ms, participant_id, total_gold, xp FROM (${source.sql}) ` +
      `ORDER BY frame_timestamp_ms, participant_id`,
    schema: TimelineChartFrameSchema,
  });
}
