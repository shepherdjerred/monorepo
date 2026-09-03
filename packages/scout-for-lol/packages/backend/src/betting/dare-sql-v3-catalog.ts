import {
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data";

const MATCH_COLUMNS = [
  "match_id",
  "game_id",
  "platform_id",
  "month",
  "game_creation_at",
  "game_start_at",
  "game_end_at",
  "game_duration_seconds",
  "queue_id",
  "queue",
  "game_mode",
  "game_type",
  "game_version",
  "end_of_game_result",
  "map_id",
] as const;

function columns(values: Record<string, DuckDbColumnType>) {
  return Object.entries(values).map(([name, type]) => ({ name, type }));
}

export function dareSqlV3Catalog() {
  const participantColumns = columns(MATCH_LAKE_COLUMNS);
  return {
    contract:
      "One read-only SELECT. Game-set CTEs return match_id, game_end_at, and nullable BOOLEAN matched. The root returns exactly one nullable BOOLEAN named achieved.",
    relations: [
      {
        name: "matches",
        columns: MATCH_COLUMNS.map((name) => ({
          name,
          type: MATCH_LAKE_COLUMNS[name],
        })),
      },
      { name: "match_participants", columns: participantColumns },
      { name: "match_teams", columns: columns(MATCH_TEAM_LAKE_COLUMNS) },
      {
        name: "match_team_bans",
        columns: columns(MATCH_TEAM_BAN_LAKE_COLUMNS),
      },
      {
        name: "timeline_events",
        columns: columns(TIMELINE_EVENT_LAKE_COLUMNS),
      },
      {
        name: "timeline_event_participants",
        columns: columns(TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS),
      },
      {
        name: "timeline_participant_frames",
        columns: columns(TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS),
      },
      {
        name: "timeline_coverage",
        columns: columns(TIMELINE_COVERAGE_LAKE_COLUMNS),
      },
      ...["T1", "T2", "T3", "T4", "T5"].map((name) => ({
        name,
        columns: participantColumns,
      })),
    ],
    rules: [
      "Use NULLIF for every division denominator; zero denominators remain NULL.",
      "Any timeline query must join timeline_coverage.",
      "Every LIMIT must order by game_end_at and match_id.",
      "Use standard SQL comparisons, aggregates, CASE, AND, OR, and NOT.",
    ],
  };
}
