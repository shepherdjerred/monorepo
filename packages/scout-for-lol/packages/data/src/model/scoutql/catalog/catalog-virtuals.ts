import {
  ALL_CONTEXTS,
  virtualColumn,
  type ScoutQlColumnInfo,
} from "#src/model/scoutql/catalog/catalog-column-types.ts";

/**
 * Every source's computed columns — dimensions, lookups and derivations.
 *
 * Each table mirrors a backend column map in reports/duckdb/column-map.ts
 * exactly: a column offered here that the engine cannot compute passes
 * analysis and then fails at run time, which the catalog tests pin.
 */

// Virtual dimensions mirror backend expr-sql.ts MATCH_VIRTUAL_COLUMNS /
// PREMATCH_VIRTUAL_COLUMNS exactly — expose only what those arms can compute.
export const MATCH_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn(
    "player",
    "varchar",
    "Tracked player (alias in guild scope, Riot ID globally). Filter with player('…').",
  ),
  virtualColumn(
    "champion",
    "varchar",
    "Champion display dimension (champion_name).",
  ),
  virtualColumn(
    "patch",
    "varchar",
    "Game patch (major.minor of game_version).",
  ),
  virtualColumn("outcome", "varchar", "'Win' or 'Loss' (from win)."),
  virtualColumn(
    "surrender_state",
    "varchar",
    "'Early surrender', 'Surrender', or 'Played out'.",
  ),
  virtualColumn(
    "arena_placement",
    "varchar",
    "Arena placement label ('Not Arena' outside Arena).",
  ),
  virtualColumn("map", "integer", "Map dimension (map_id)."),
  // Looked up from this participant's team row. Numbers, not dimensions, so
  // they carry a numeric display kind rather than virtualColumn's text.
  {
    name: "team_champion_kills",
    type: "integer",
    description:
      "Champion kills by this participant's whole team in the game (from the team row).",
    displayKind: "count",
    virtual: true,
    contexts: { select: true, where: true, groupBy: false },
  },
  {
    name: "kill_participation",
    type: "double",
    description:
      "Share of the team's kills this participant took part in: (kills + assists) / team champion kills. NULL when the team had no kills.",
    displayKind: "percent",
    virtual: true,
    contexts: { select: true, where: true, groupBy: false },
  },
];

export const PREMATCH_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn(
    "player",
    "varchar",
    "Tracked player (alias in guild scope, Riot ID globally). Filter with player('…').",
  ),
  virtualColumn(
    "champion",
    "varchar",
    "Champion dimension (numeric id shown — prematch rows carry no name).",
  ),
  virtualColumn("map", "integer", "Map dimension (map_id)."),
];

/**
 * Team rows carry no match facts of their own, so the engine looks them up.
 *
 * `match_teams` holds only `match_id`, `team_id` and the objective columns —
 * no timestamp, no queue, no version. Every one of those is needed to ask an
 * objective question honestly: "first dragon wins more" is meaningless over a
 * corpus that mixes Summoner's Rift with ARAM, where no dragon exists and both
 * teams land in the same bucket. So the compiler joins one row per match from
 * the participant table and projects these four; the join is keyed on
 * `match_id` and collapsed to one row per match, so it cannot fan a team row
 * out. It is a lookup of the parent row, not a join between two fact sources —
 * ScoutQL plans remain single-source.
 */
export const MATCH_TEAM_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn("outcome", "varchar", "'Win' or 'Loss' (from win)."),
  virtualColumn(
    "side",
    "varchar",
    "'Blue' or 'Red' (from team_id); the raw id for modes that use others.",
  ),
  virtualColumn(
    "game_creation_at",
    "timestamp",
    "When the lobby was created (UTC), from the match this team played.",
  ),
  virtualColumn(
    "queue",
    "varchar",
    "Queue name of the match (solo, flex, aram, …); NULL for unmapped queues.",
  ),
  virtualColumn(
    "patch",
    "varchar",
    "Game patch (major.minor) of the match this team played.",
  ),
  virtualColumn("map", "integer", "Map dimension (map_id) of the match."),
];

/** A ban row reads the same looked-up match facts as a team row, plus a champion name. */
export const MATCH_TEAM_BAN_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn(
    "champion",
    "varchar",
    "Banned champion's name, from Scout's champion registry ('No ban' for an unused slot).",
  ),
  ...MATCH_TEAM_VIRTUALS.filter((column) => column.name !== "outcome"),
];

/**
 * What a frame reads from its participant and team, plus per-minute derivations.
 *
 * A frame is a snapshot of one player at one minute; champion, position,
 * team, result and match time come from that player's participant row, as
 * the backend's frame column map looks them up. The two gold differences are
 * computed against the other team, and against the same position on it.
 */
export const TIMELINE_FRAME_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn(
    "player",
    "varchar",
    "Tracked player (alias in guild scope, Riot ID globally). Filter with player('…').",
  ),
  virtualColumn(
    "champion",
    "varchar",
    "Champion the player was on (from their participant row).",
  ),
  // Present so champion('Name'), which expands to champion_id, works here.
  {
    name: "champion_id",
    type: "integer",
    description:
      "Numeric id of the champion the player was on (compare with champion('Name')).",
    displayKind: "count",
    virtual: true,
    contexts: { select: false, where: true, groupBy: false },
  },
  virtualColumn(
    "team_position",
    "varchar",
    "Position the player was assigned (TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY).",
  ),
  virtualColumn(
    "outcome",
    "varchar",
    "'Win' or 'Loss' for the player's team in that game.",
  ),
  virtualColumn("side", "varchar", "'Blue' or 'Red' (from the player's team)."),
  virtualColumn(
    "game_creation_at",
    "timestamp",
    "When the lobby was created (UTC), from the match.",
  ),
  virtualColumn(
    "queue",
    "varchar",
    "Queue name of the match (solo, flex, aram, …).",
  ),
  virtualColumn("patch", "varchar", "Game patch (major.minor) of the match."),
  virtualColumn("map", "integer", "Map dimension (map_id) of the match."),
  {
    name: "minute",
    type: "integer",
    description:
      "Whole minutes on the game clock at this frame: WHERE minute = 10 for the ten-minute mark.",
    displayKind: "count",
    virtual: true,
    contexts: ALL_CONTEXTS,
  },
  {
    name: "creep_score",
    type: "integer",
    description:
      "Lane minions plus jungle monsters killed so far at this frame.",
    displayKind: "count",
    virtual: true,
    contexts: { select: true, where: true, groupBy: false },
  },
  {
    name: "team_gold_diff",
    type: "integer",
    description:
      "The player's team's total gold minus the other team's, at this frame. NULL outside two-team modes.",
    displayKind: "count",
    virtual: true,
    contexts: { select: true, where: true, groupBy: false },
  },
  {
    name: "lane_gold_diff",
    type: "integer",
    description:
      "The player's total gold minus their lane opponent's (same position, other team), at this frame. NULL without an assigned position.",
    displayKind: "count",
    virtual: true,
    contexts: { select: true, where: true, groupBy: false },
  },
];
