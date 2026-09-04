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
      "Streaks use eligible rows only, ordered by game_end_at then match_id; every eligible miss resets the run.",
      "Distinct streaks count a projected value such as champion_id inside a winning run.",
      "Item and skill sequences order by event_timestamp_ms, frame_index, then event_index within one match.",
      "Ordered-subsequence sequences allow unrelated family events; exact sequences reject intervening events of the same family.",
      "ITEM_PURCHASED records purchase order; ITEM_SOLD and ITEM_UNDO do not erase purchases.",
      "Skill slots 1, 2, 3, and 4 render as Q, W, E, and R.",
      "Opponent-team joins use unequal team_id values and automatically exclude matches with other than two teams.",
      "A race declares one game-set lane per target; earliest game_end_at wins and exact timestamp ties split the pot.",
      "Rank activation supports solo or flex reach and normalized-LP-gain goals; every target must be ranked in the one selected queue.",
      "Improvement activation freezes an explicit last-N-games or last-N-days numeric baseline and uses average, maximum, or minimum aggregation.",
      "Personal best is strict; ties never qualify. Absolute and percentage improvement can move higher or lower.",
    ],
  };
}
