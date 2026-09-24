import { match } from "ts-pattern";
import {
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data/model/reports/lake-columns.ts";
import {
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "@scout-for-lol/data/model/reports/timeline-lake-columns.ts";

/**
 * Which column names each ScoutQL source exposes, and the SQL each becomes.
 *
 * The map is the only thing that turns an identifier into SQL: a name absent
 * from it throws before any query text exists, which is what keeps the closed
 * vocabulary closed. Split from the expression compiler because it is a
 * vocabulary, not a translation — it grows with the lake schema, while the
 * compiler grows with the language.
 */

export type SqlTypeClass =
  "numeric" | "boolean" | "text" | "timestamp" | "date" | "interval";

export type ColumnBinding = {
  /** SQL over bare source-column names (valid in union branches and facts). */
  sql: string;
  type: SqlTypeClass;
  /** Source columns this expression reads (grown into the facts projection). */
  dependencies: readonly string[];
  /** Identity columns exist only after the facts projection, never in a
   * union-branch pushdown context. */
  identity: boolean;
};

export type ColumnMap = ReadonlyMap<string, ColumnBinding>;

export type PlanColumnSource =
  | "match"
  | "prematch"
  | "match-team"
  | "match-team-ban"
  | "timeline-frame"
  | "timeline-event";

/**
 * Sources whose rows hold no match facts of their own — no timestamp, queue
 * or version, and no player — and read them from the match dimension. Both
 * are global-only and refuse player and champion-by-participant groupings for
 * the same reason, so every such rule is keyed on this rather than on a name.
 */
export function readsMatchDimension(source: PlanColumnSource): boolean {
  return source === "match-team" || source === "match-team-ban";
}

/**
 * Sources whose match time is looked up rather than on the row, so the time
 * window restricts the lookup and the row scan is joined to it. Timeline
 * frames name a player, unlike team and ban rows, so this is wider than
 * `readsMatchDimension`.
 */
export function timeFromLookup(source: PlanColumnSource): boolean {
  return (
    readsMatchDimension(source) ||
    source === "timeline-frame" ||
    source === "timeline-event"
  );
}

/**
 * Event columns computed from rows other than the event itself, joined only
 * when a query names one. `is_first_of_kind` is a window over the match's
 * events and so limits filter pushdown when named: filtering to Elder
 * dragons first would redefine which dragon was first.
 */
/**
 * The first-of-kind window's partition. A filter reading only these keeps or
 * drops whole partitions, so it cannot change which event is first and may
 * still be pushed into the event scan.
 */
export const FIRST_OF_KIND_PARTITION: ReadonlySet<string> = new Set([
  "match_id",
  "event_type",
  "monster_type",
  "building_type",
]);

export const EVENT_LOOKUPS = {
  firstOfKind: "is_first_of_kind",
  killerTeamWon: "killer_team_won",
  assistCount: "assist_count",
  soloKill: "is_solo_kill",
} as const;

const LAKE_TYPE_CLASS: Record<DuckDbColumnType, SqlTypeClass> = {
  VARCHAR: "text",
  INTEGER: "numeric",
  BIGINT: "numeric",
  DOUBLE: "numeric",
  BOOLEAN: "boolean",
  TIMESTAMP: "timestamp",
};

function sourceColumnEntries(
  columns: Record<string, DuckDbColumnType>,
): [string, ColumnBinding][] {
  return Object.entries(columns).map(([name, type]) => [
    name,
    {
      sql: name,
      type: LAKE_TYPE_CLASS[type],
      dependencies: [name],
      identity: false,
    },
  ]);
}

function virtual(
  sql: string,
  type: SqlTypeClass,
  dependencies: string[],
): ColumnBinding {
  return { sql, type, dependencies, identity: false };
}

const PLAYER_BINDING: ColumnBinding = {
  sql: "player_alias",
  type: "text",
  dependencies: [],
  identity: true,
};

const SURRENDER_STATE_SQL =
  "CASE WHEN early_surrendered THEN 'Early surrender' WHEN surrendered THEN 'Surrender' ELSE 'Played out' END";

/**
 * Match facts looked up for a team row, which carries none of its own.
 *
 * Marked `identity` for the same reason player columns are: they do not exist
 * in the union-branch pushdown context, only after the facts projection joins
 * the match dimension. That routes any predicate over them to the residual
 * WHERE, which runs against facts — where they do exist.
 */
function lookedUp(sql: string, type: SqlTypeClass): ColumnBinding {
  return { sql, type, dependencies: [], identity: true };
}

/**
 * The team a participant played on, looked up from `match_teams`.
 *
 * A participant row carries its own kills but not its team's, so kill
 * participation — the share of a team's kills a player took part in — could
 * not be computed from one source. The team row is the participant row's
 * parent on `(match_id, team_id)`, so, as with the match dimension on
 * `match_teams`, it is looked up rather than joined as a second fact source.
 * The lookup is added to the facts CTE only when a query names one of these.
 */
export const TEAM_LOOKUP_COLUMNS: ReadonlySet<string> = new Set([
  "team_champion_kills",
  "kill_participation",
]);

/** Virtual dimensions over match facts, mirroring the grouping arms. */
const MATCH_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["player", PLAYER_BINDING],
  ["champion", virtual("champion_name", "text", ["champion_name"])],
  [
    "patch",
    virtual(
      String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`,
      "text",
      ["game_version"],
    ),
  ],
  [
    "outcome",
    virtual("CASE WHEN win THEN 'Win' ELSE 'Loss' END", "text", ["win"]),
  ],
  [
    "surrender_state",
    virtual(SURRENDER_STATE_SQL, "text", ["early_surrendered", "surrendered"]),
  ],
  [
    "arena_placement",
    virtual("coalesce(placement::VARCHAR, 'Not Arena')", "text", ["placement"]),
  ],
  ["map", virtual("map_id", "numeric", ["map_id"])],
  ["team_champion_kills", lookedUp("team_champion_kills", "numeric")],
  [
    "kill_participation",
    {
      // NULL rather than a division by zero for a team with no kills.
      sql: "((kills + assists)::DOUBLE / NULLIF(team_champion_kills, 0))",
      type: "numeric",
      dependencies: ["kills", "assists"],
      identity: true,
    },
  ],
];

/** Prematch rows have no champion_name; the dimension shows the numeric id. */
const PREMATCH_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["player", PLAYER_BINDING],
  ["champion", virtual("champion_id::VARCHAR", "text", ["champion_id"])],
  ["map", virtual("map_id", "numeric", ["map_id"])],
];

// Arena and other modes put team ids outside the 100/200 pair, so an
// `ELSE 'Red'` would label them wrongly rather than admit it does not know.
const SIDE_BINDING = virtual(
  "CASE team_id WHEN 100 THEN 'Blue' WHEN 200 THEN 'Red' ELSE team_id::VARCHAR END",
  "text",
  ["team_id"],
);

const MATCH_TEAM_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  [
    "outcome",
    virtual("CASE WHEN win THEN 'Win' ELSE 'Loss' END", "text", ["win"]),
  ],
  ["side", SIDE_BINDING],
  ["game_creation_at", lookedUp("game_creation_at", "timestamp")],
  ["queue", lookedUp("queue", "text")],
  ["patch", lookedUp("patch", "text")],
  ["map", lookedUp("map_id", "numeric")],
];

/**
 * A ban row names a champion by id alone; its name comes from the bundled
 * champion registry, joined in the facts CTE as `champion_name` (see
 * select-sql.ts), so grouping by champion labels it like a participant row.
 */
const MATCH_TEAM_BAN_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["champion", lookedUp("champion_name", "text")],
  ["side", SIDE_BINDING],
  ["game_creation_at", lookedUp("game_creation_at", "timestamp")],
  ["queue", lookedUp("queue", "text")],
  ["patch", lookedUp("patch", "text")],
  ["map", lookedUp("map_id", "numeric")],
];

/**
 * A frame reads its player's participant row for everything but the
 * snapshot itself: champion, position, team, result and match time.
 */
const TIMELINE_FRAME_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["player", PLAYER_BINDING],
  ["champion", lookedUp("champion_name", "text")],
  ["champion_id", lookedUp("champion_id", "numeric")],
  ["team_position", lookedUp("team_position", "text")],
  ["team_id", lookedUp("team_id", "numeric")],
  ["win", lookedUp("win", "boolean")],
  ["outcome", lookedUp("CASE WHEN win THEN 'Win' ELSE 'Loss' END", "text")],
  ["side", lookedUp(SIDE_BINDING.sql, "text")],
  ["game_creation_at", lookedUp("game_creation_at", "timestamp")],
  ["queue", lookedUp("queue", "text")],
  ["patch", lookedUp("patch", "text")],
  ["map", lookedUp("map_id", "numeric")],
  [
    "minute",
    virtual("(floor(frame_timestamp_ms / 60000))::INTEGER", "numeric", [
      "frame_timestamp_ms",
    ]),
  ],
  [
    "creep_score",
    virtual("(minions_killed + jungle_minions_killed)", "numeric", [
      "minions_killed",
      "jungle_minions_killed",
    ]),
  ],
  ["team_gold_diff", lookedUp("team_gold_diff", "numeric")],
  ["lane_gold_diff", lookedUp("lane_gold_diff", "numeric")],
];

/**
 * An event's player is its actor — whoever killed, bought or placed —
 * looked up from the participant row by slot. Match time and queue come
 * from the match, so objective events with no player actor still count.
 */
const TIMELINE_EVENT_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["player", PLAYER_BINDING],
  // The actor's puuid, which grouping by player keys on in global scope. An
  // event row has none of its own; facts carries the looked-up one.
  ["puuid", lookedUp("puuid", "text")],
  ["champion", lookedUp("champion_name", "text")],
  ["champion_id", lookedUp("champion_id", "numeric")],
  ["team_position", lookedUp("team_position", "text")],
  ["game_creation_at", lookedUp("game_creation_at", "timestamp")],
  ["queue", lookedUp("queue", "text")],
  ["patch", lookedUp("patch", "text")],
  ["map", lookedUp("map_id", "numeric")],
  [
    "minute",
    virtual("(floor(event_timestamp_ms / 60000))::INTEGER", "numeric", [
      "event_timestamp_ms",
    ]),
  ],
  [EVENT_LOOKUPS.firstOfKind, lookedUp("is_first_of_kind", "boolean")],
  [EVENT_LOOKUPS.killerTeamWon, lookedUp("killer_team_won", "boolean")],
  [EVENT_LOOKUPS.assistCount, lookedUp("assist_count", "numeric")],
  [
    EVENT_LOOKUPS.soloKill,
    {
      // killer_id 0 is an execution — a tower or minion got the kill, and
      // with nobody assisting it would otherwise count as nobody's solo kill.
      sql: "(event_type = 'CHAMPION_KILL' AND killer_id > 0 AND assist_count = 0)",
      type: "boolean",
      dependencies: ["event_type", "killer_id"],
      identity: true,
    },
  ],
];

export function buildPlanColumnMap(source: PlanColumnSource): ColumnMap {
  return match(source)
    .with(
      "match",
      () =>
        new Map([
          ...sourceColumnEntries(MATCH_LAKE_COLUMNS),
          ...MATCH_VIRTUAL_COLUMNS,
        ]),
    )
    .with(
      "prematch",
      () =>
        new Map([
          ...sourceColumnEntries(PREMATCH_LAKE_COLUMNS),
          ...PREMATCH_VIRTUAL_COLUMNS,
        ]),
    )
    .with(
      "match-team",
      () =>
        new Map([
          ...sourceColumnEntries(MATCH_TEAM_LAKE_COLUMNS),
          ...MATCH_TEAM_VIRTUAL_COLUMNS,
        ]),
    )
    .with(
      "match-team-ban",
      () =>
        new Map([
          ...sourceColumnEntries(MATCH_TEAM_BAN_LAKE_COLUMNS),
          ...MATCH_TEAM_BAN_VIRTUAL_COLUMNS,
        ]),
    )
    .with(
      "timeline-frame",
      () =>
        new Map([
          ...sourceColumnEntries(TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS),
          ...TIMELINE_FRAME_VIRTUAL_COLUMNS,
        ]),
    )
    .with(
      "timeline-event",
      () =>
        new Map([
          ...sourceColumnEntries(TIMELINE_EVENT_LAKE_COLUMNS),
          ...TIMELINE_EVENT_VIRTUAL_COLUMNS,
        ]),
    )
    .exhaustive();
}

export function resolveColumn(columns: ColumnMap, name: string): ColumnBinding {
  const binding = columns.get(name);
  if (binding === undefined) {
    throw new Error(`Unknown column "${name}" for this source.`);
  }
  return binding;
}
