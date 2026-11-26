import { type RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { MATCH_UI_READ_COLUMNS } from "#src/report-lake/loadout.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  buildTimelineParticipantFramesSource,
  listParam,
  scalarParam,
  withLakeQueryRetry,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  fullMatchRowsSql,
  MatchParticipantRowSchema,
  type LakeMatchParticipantRow,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

/** The timeline events the Match story reads, and nothing else. */
export const STORY_EVENT_TYPES = [
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
  "ITEM_PURCHASED",
  "ITEM_UNDO",
  "ITEM_SOLD",
  "SKILL_LEVEL_UP",
] as const;

const StoryEventSchema = z.object({
  event_id: z.string(),
  event_timestamp_ms: LakeIntSchema,
  event_type: z.string(),
  participant_id: LakeIntSchema.nullable(),
  killer_id: LakeIntSchema.nullable(),
  victim_id: LakeIntSchema.nullable(),
  team_id: LakeIntSchema.nullable(),
  killer_team_id: LakeIntSchema.nullable(),
  item_id: LakeIntSchema.nullable(),
  before_id: LakeIntSchema.nullable(),
  after_id: LakeIntSchema.nullable(),
  skill_slot: LakeIntSchema.nullable(),
  level_up_type: z.string().nullable(),
  building_type: z.string().nullable(),
  lane_type: z.string().nullable(),
  tower_type: z.string().nullable(),
  monster_type: z.string().nullable(),
  monster_sub_type: z.string().nullable(),
  winning_team_id: LakeIntSchema.nullable(),
});

export type StoryEvent = z.infer<typeof StoryEventSchema>;

const StoryAssistSchema = z.object({
  event_id: z.string(),
  participant_id: LakeIntSchema,
});

export type StoryAssist = z.infer<typeof StoryAssistSchema>;

const StoryFrameSchema = z.object({
  frame_timestamp_ms: LakeIntSchema,
  participant_id: LakeIntSchema,
  total_gold: LakeIntSchema,
  level: LakeIntSchema,
});

export type StoryFrame = z.infer<typeof StoryFrameSchema>;

const CoverageSchema = z.object({ frame_count: LakeIntSchema });

export type MatchStoryRead = {
  /** The match roster; empty when the lake has no such match. */
  rows: LakeMatchParticipantRow[];
  /** Whether the lake holds a timeline for the match. */
  hasTimeline: boolean;
  events: StoryEvent[];
  /** Assisting participants of kills and objectives. */
  assists: StoryAssist[];
  frames: StoryFrame[];
};

async function runOn<T>(
  session: DuckDBSession,
  source: SqlFragment,
  sql: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const rows = await session.run(sql, bindParams(session, source.params));
  return rows.map((row) => schema.parse(row));
}

const EVENT_COLUMNS = Object.keys(StoryEventSchema.shape).join(", ");
const FRAME_COLUMNS = Object.keys(StoryFrameSchema.shape).join(", ");

/**
 * Everything the Match story needs, in one report-pool slot: the roster, the
 * timeline's coverage, its story events, their assists and the participant
 * frames. The page reads the lake once; the statements share one connection.
 *
 * Call it before authorization only to read: nothing it returns may reach the
 * caller until the caller has confirmed the viewer's player was in `rows`.
 */
export async function fetchMatchStoryRead(options: {
  matchId: RiotMatchId;
  lakeDir?: string;
}): Promise<MatchStoryRead> {
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const predicate = {
        sql: "match_id = ?",
        params: [scalarParam(options.matchId)],
      };
      const matches = buildMatchesSource(
        files,
        predicate,
        MATCH_UI_READ_COLUMNS,
      );
      const coverage = buildTimelineCoverageSource(files, predicate);
      const events = buildTimelineEventsSource(files, {
        sql: "match_id = ? AND event_type IN (SELECT unnest(?))",
        params: [
          scalarParam(options.matchId),
          listParam([...STORY_EVENT_TYPES]),
        ],
      });
      const assists = buildTimelineEventParticipantsSource(files, {
        sql: "match_id = ? AND role = 'assist'",
        params: [scalarParam(options.matchId)],
      });
      const frames = buildTimelineParticipantFramesSource(files, predicate);
      return await withDuckDBConnection(async (session) => {
        const rows =
          matches === undefined
            ? []
            : await runOn(
                session,
                matches,
                fullMatchRowsSql(matches.sql),
                MatchParticipantRowSchema,
              );
        const coverageRows =
          coverage === undefined
            ? []
            : await runOn(
                session,
                coverage,
                `SELECT frame_count FROM (${coverage.sql}) LIMIT 1`,
                CoverageSchema,
              );
        return {
          rows,
          hasTimeline: coverageRows.length > 0,
          events:
            events === undefined
              ? []
              : await runOn(
                  session,
                  events,
                  `SELECT ${EVENT_COLUMNS} FROM (${events.sql}) ` +
                    `ORDER BY event_timestamp_ms, frame_index, event_index, event_id`,
                  StoryEventSchema,
                ),
          assists:
            assists === undefined
              ? []
              : await runOn(
                  session,
                  assists,
                  `SELECT event_id, participant_id FROM (${assists.sql}) ` +
                    `ORDER BY event_id, role_index`,
                  StoryAssistSchema,
                ),
          frames:
            frames === undefined
              ? []
              : await runOn(
                  session,
                  frames,
                  `SELECT ${FRAME_COLUMNS} FROM (${frames.sql}) ` +
                    `ORDER BY frame_timestamp_ms, participant_id`,
                  StoryFrameSchema,
                ),
        };
      });
    },
  );
}
