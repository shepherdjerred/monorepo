import { type RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { MATCH_UI_READ_COLUMNS } from "#src/report-lake/loadout.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  buildMatchesSource,
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  buildTimelineParticipantFramesSource,
  listParam,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";
import {
  fullMatchRowsSql,
  MatchParticipantRowSchema,
  runSource,
  TimelineEventReadSchema,
  TimelineFrameReadSchema,
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

/** The columns of a timeline event the story reads, as the lake read types them. */
const StoryEventSchema = TimelineEventReadSchema.pick({
  event_id: true,
  event_timestamp_ms: true,
  event_type: true,
  participant_id: true,
  killer_id: true,
  victim_id: true,
  team_id: true,
  killer_team_id: true,
  item_id: true,
  before_id: true,
  after_id: true,
  skill_slot: true,
  level_up_type: true,
  building_type: true,
  lane_type: true,
  tower_type: true,
  monster_type: true,
  monster_sub_type: true,
  winning_team_id: true,
});

export type StoryEvent = z.infer<typeof StoryEventSchema>;

const StoryAssistSchema = z.object({
  event_id: z.string(),
  participant_id: LakeIntSchema,
});

export type StoryAssist = z.infer<typeof StoryAssistSchema>;

const StoryFrameSchema = TimelineFrameReadSchema.pick({
  frame_timestamp_ms: true,
  participant_id: true,
  total_gold: true,
  level: true,
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
  return await withLakePage(options.lakeDir, async (page) => {
    const { files, session } = page;
    const predicate = {
      sql: "match_id = ?",
      params: [scalarParam(options.matchId)],
    };
    const matches = buildMatchesSource(files, predicate, MATCH_UI_READ_COLUMNS);
    const coverage = buildTimelineCoverageSource(files, predicate);
    const events = buildTimelineEventsSource(files, {
      sql: "match_id = ? AND event_type IN (SELECT unnest(?))",
      params: [scalarParam(options.matchId), listParam([...STORY_EVENT_TYPES])],
    });
    const assists = buildTimelineEventParticipantsSource(files, {
      sql: "match_id = ? AND role = 'assist'",
      params: [scalarParam(options.matchId)],
    });
    const frames = buildTimelineParticipantFramesSource(files, predicate);
    const rows =
      matches === undefined
        ? []
        : await runSource({
            session,
            source: matches,
            sql: fullMatchRowsSql(matches.sql),
            schema: MatchParticipantRowSchema,
          });
    const coverageRows =
      coverage === undefined
        ? []
        : await runSource({
            session,
            source: coverage,
            sql: `SELECT frame_count FROM (${coverage.sql}) LIMIT 1`,
            schema: CoverageSchema,
          });
    return {
      rows,
      hasTimeline: coverageRows.length > 0,
      events:
        events === undefined
          ? []
          : await runSource({
              session,
              source: events,
              sql:
                `SELECT ${EVENT_COLUMNS} FROM (${events.sql}) ` +
                `ORDER BY event_timestamp_ms, frame_index, event_index, event_id`,
              schema: StoryEventSchema,
            }),
      assists:
        assists === undefined
          ? []
          : await runSource({
              session,
              source: assists,
              sql:
                `SELECT event_id, participant_id FROM (${assists.sql}) ` +
                `ORDER BY event_id, role_index`,
              schema: StoryAssistSchema,
            }),
      frames:
        frames === undefined
          ? []
          : await runSource({
              session,
              source: frames,
              sql:
                `SELECT ${FRAME_COLUMNS} FROM (${frames.sql}) ` +
                `ORDER BY frame_timestamp_ms, participant_id`,
              schema: StoryFrameSchema,
            }),
    };
  });
}
