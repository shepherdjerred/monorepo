import { match } from "ts-pattern";
import { getAllChampions } from "@scout-for-lol/data";
import { buildAccountsSource, listParam } from "#src/reports/duckdb/lake.ts";
import type { LakeFiles, SqlFragment } from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import {
  readsMatchDimension,
  type PlanColumnSource,
} from "#src/reports/duckdb/column-map.ts";
import { frag, joinFragments, seq } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * Facts for a row with no player — a team or a ban — read with the match
 * dimension and, for bans, champion names.
 */
function teamRowFacts(input: FactsCteInput, items: SqlFragment): SqlFragment {
  const banSource = input.columnSource === "match-team-ban";
  const dimension = input.matchDimension;
  if (dimension === undefined) {
    throw new Error("match_teams compile requires a match dimension.");
  }
  return seq(
    "WITH ",
    matchDimensionCte(dimension),
    banSource ? seq(", ", championNamesCte()) : frag(""),
    ", facts AS (SELECT ",
    items,
    " FROM (",
    input.source,
    ") m JOIN match_dim d ON d.match_id = m.match_id",
    banSource
      ? frag(" LEFT JOIN champion_names cn ON cn.champion_id = m.champion_id")
      : frag(""),
    ")",
  );
}

/**
 * The facts CTE: every source's rows, with identity attached and any looked-up
 * facts joined, projected under bare column names for the aggregate tail.
 *
 * Split from the SELECT assembly because it is the part that grows with the
 * lake — each source that lacks something (a timestamp, a player, a team
 * total, a champion name) adds a keyed lookup here — while the tail grows
 * with the language.
 */

export type FactsCteInput = {
  scope: LakeQueryScope;
  files: LakeFiles;
  columnSource: PlanColumnSource;
  source: SqlFragment;
  /**
   * Participant rows the match dimension is derived from — match_teams only,
   * where the time window and every match-level column live.
   */
  matchDimension?: SqlFragment | undefined;
  /**
   * The match_teams rows a participant's team is looked up from — present
   * only when the plan names a team lookup column.
   */
  teamDimension?: SqlFragment | undefined;
  /**
   * Participant rows a timeline frame reads its player's facts from — frames
   * only, where the time window and every participant-level column live.
   */
  participantDimension?: SqlFragment | undefined;
  /**
   * Event lookups, each present only when named: the first-of-kind window
   * (no source — it runs over the event scan itself), the killing team's
   * result from match_teams, and assist counts from event participants.
   */
  eventLookups?:
    | {
        readonly firstOfKind: boolean;
        readonly killerTeam: SqlFragment | undefined;
        readonly assists: SqlFragment | undefined;
      }
    | undefined;
  /** An unfiltered frame scan, and which gold differences to compute from it. */
  frameGold?:
    | {
        readonly source: SqlFragment;
        /** The source scan was filtered, and the gold scan narrowed to it. */
        readonly narrowed: boolean;
        readonly team: boolean;
        readonly lane: boolean;
      }
    | undefined;
  /** Value columns to project as `m.X AS X` (identity handled separately). */
  projected: string[];
  /** Extra computed items (group-facts virtual columns), already fragments. */
  extraItems: SqlFragment[];
};

function identityProjection(
  scope: LakeQueryScope,
  columnSource: PlanColumnSource,
): string {
  if (scope.kind === "guild") {
    return "a.player_id AS player_id, a.player_alias AS player_alias, a.discord_id AS discord_id";
  }
  // Global scope: no accounts dimension exists, so the row labels itself with
  // the Riot ID already on the fact. player_alias keeps its name so both
  // scopes produce the same facts shape.
  const alias = match(columnSource)
    .with(
      "match",
      () =>
        "concat_ws('#', m.riot_id_game_name, m.riot_id_tagline) AS player_alias",
    )
    .with("prematch", () => "m.riot_id AS player_alias")
    // A frame carries only a puuid and an event only a slot; either way the
    // Riot ID comes from the participant row.
    .with("timeline-frame", "timeline-event", () => "p.riot_id AS player_alias")
    // A team is not a player and has no name to label itself with. The column
    // keeps its place so the facts shape stays uniform; the grouping arms
    // reject `player` on this source, so nothing ever reads it.
    .with("match-team", "match-team-ban", () => "NULL::VARCHAR AS player_alias")
    .exhaustive();
  return `NULL::BIGINT AS player_id, ${alias}, NULL::VARCHAR AS discord_id`;
}

/**
 * One row per match, carrying the facts a team row lacks.
 *
 * Collapsed with `any_value` over `GROUP BY match_id` rather than `DISTINCT`:
 * these are match-level fields repeated on all ten participant rows, and
 * grouping guarantees one row per match even if a single field ever disagreed
 * between them. That is what keeps the join from fanning a team row out.
 */
function matchDimensionCte(dimension: SqlFragment): SqlFragment {
  return seq(
    "match_dim AS (SELECT match_id, any_value(game_creation_at) AS game_creation_at, any_value(queue) AS queue, any_value(",
    frag(String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`),
    ") AS patch, any_value(map_id) AS map_id FROM (",
    dimension,
    ") GROUP BY match_id)",
  );
}

/** One row per (match, team), for the same reason the match dimension is grouped. */
function teamDimensionCte(dimension: SqlFragment): SqlFragment {
  return seq(
    "team_dim AS (SELECT match_id, team_id, any_value(champion_kills) AS team_champion_kills FROM (",
    dimension,
    ") GROUP BY match_id, team_id)",
  );
}

const TEAM_LOOKUP_ITEMS = "t.team_champion_kills AS team_champion_kills";
const TEAM_LOOKUP_JOIN =
  " LEFT JOIN team_dim t ON t.match_id = m.match_id AND t.team_id = m.team_id";

/**
 * Champion names by id, from the bundled registry, for rows that carry only
 * the id. Travels as two bound lists zipped by DuckDB's parallel unnest, so no
 * name is ever written into SQL text. Riot records an unused ban slot as -1.
 */
function championNamesCte(): SqlFragment {
  const champions = getAllChampions();
  return frag(
    "champion_names AS (SELECT unnest(?) AS champion_id, unnest(?) AS champion_name)",
    [
      listParam([-1, ...champions.map((champion) => champion.id)]),
      listParam(["No ban", ...champions.map((champion) => champion.name)]),
    ],
  );
}

/**
 * One row per (match, puuid): the participant facts a timeline frame lacks.
 * Grouped for the same reason the match dimension is — a join against it can
 * never fan a frame out.
 */
function participantDimensionCte(dimension: SqlFragment): SqlFragment {
  return seq(
    "part_dim AS (SELECT match_id, puuid, any_value(game_creation_at) AS game_creation_at, any_value(queue) AS queue, any_value(",
    frag(String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`),
    ") AS patch, any_value(map_id) AS map_id, any_value(participant_id) AS participant_id, any_value(team_id) AS team_id, any_value(champion_id) AS champion_id, any_value(champion_name) AS champion_name, any_value(team_position) AS team_position, any_value(win) AS win, any_value(concat_ws('#', riot_id_game_name, riot_id_tagline)) AS riot_id FROM (",
    dimension,
    ") GROUP BY match_id, puuid)",
  );
}

const PARTICIPANT_ITEMS =
  "p.game_creation_at AS game_creation_at, p.queue AS queue, p.patch AS patch, p.map_id AS map_id, p.champion_id AS champion_id, p.champion_name AS champion_name, p.team_position AS team_position, p.team_id AS team_id, p.win AS win";

const PARTICIPANT_JOIN =
  " JOIN part_dim p ON p.match_id = m.match_id AND p.puuid = m.puuid";

/** The other side of a two-team game. Arena and other modes get NULL, never a wrong team. */
const OTHER_TEAM = "CASE p.team_id WHEN 100 THEN 200 WHEN 200 THEN 100 END";

/**
 * The (match, frame) pairs the source scan kept. The gold scans are
 * unfiltered so a team total sums every player, but only the frames a query
 * reads need a total: without this they aggregated every frame in the lake.
 */
function frameKeysCte(frames: SqlFragment): SqlFragment {
  return seq(
    "frame_keys AS (SELECT DISTINCT match_id, frame_index FROM (",
    frames,
    "))",
  );
}

/**
 * The gold scan's own filter. The scan deduplicates staged and compacted
 * rows with a window, and that window held every frame in the lake unless
 * the scan was narrowed first. This keeps a superset of the kept pairs; the
 * semi join below narrows it to exactly them.
 */
export const FRAME_KEYS_SCAN_FILTER =
  "match_id IN (SELECT match_id FROM frame_keys) AND frame_index IN (SELECT frame_index FROM frame_keys)";

const FRAME_KEYS_SEMI_JOIN =
  " SEMI JOIN frame_keys k ON k.match_id = f.match_id AND k.frame_index = f.frame_index";

/**
 * Both teams' total gold at each frame, one row per (match, frame). Pivoted
 * rather than one row per team, so a frame reads its own and its foe's total
 * from one join: two joins against a per-team table ran out of memory over a
 * whole lake of frames.
 */
function teamGoldCte(frames: SqlFragment, narrowed: boolean): SqlFragment {
  return seq(
    "team_gold AS (SELECT f.match_id, f.frame_index, sum(f.total_gold) FILTER (WHERE pd.team_id = 100) AS blue, sum(f.total_gold) FILTER (WHERE pd.team_id = 200) AS red FROM (",
    frames,
    `) f${narrowed ? FRAME_KEYS_SEMI_JOIN : ""} JOIN part_dim pd ON pd.match_id = f.match_id AND pd.puuid = f.puuid GROUP BY f.match_id, f.frame_index)`,
  );
}

/**
 * Each laner's gold at each frame, one row per (match, frame, team, position)
 * — so "the same position on the other team" names one row or none. Players
 * without an assigned position (ARAM, remakes) are left out, which makes
 * their lane difference NULL rather than paired with a stranger.
 */
function laneGoldCte(frames: SqlFragment, narrowed: boolean): SqlFragment {
  return seq(
    "lane_gold AS (SELECT f.match_id, f.frame_index, pd.team_id, pd.team_position, any_value(f.total_gold) AS gold FROM (",
    frames,
    `) f${narrowed ? FRAME_KEYS_SEMI_JOIN : ""} JOIN part_dim pd ON pd.match_id = f.match_id AND pd.puuid = f.puuid WHERE pd.team_position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY') GROUP BY f.match_id, f.frame_index, pd.team_id, pd.team_position)`,
  );
}

const TEAM_GOLD_JOIN =
  " LEFT JOIN team_gold tg ON tg.match_id = m.match_id AND tg.frame_index = m.frame_index";
/** Arena and other modes have neither side, and get NULL, never a wrong total. */
const TEAM_GOLD_DIFF =
  "CASE p.team_id WHEN 100 THEN tg.blue - tg.red WHEN 200 THEN tg.red - tg.blue END AS team_gold_diff";
const LANE_GOLD_JOIN = ` LEFT JOIN lane_gold lo ON lo.match_id = m.match_id AND lo.frame_index = m.frame_index AND lo.team_position = p.team_position AND lo.team_id = ${OTHER_TEAM}`;

type Lookups = {
  readonly ctes: SqlFragment[];
  readonly joins: string;
  readonly items: string[];
};

/** The keyed lookups a row-level source (participants, frames) joins into facts. */
/**
 * One row per (match, slot): the participant an event's actor slot names.
 * Grouped by slot, where frames group by puuid, because events carry a slot.
 */
function actorDimensionCte(dimension: SqlFragment): SqlFragment {
  return seq(
    "actor_dim AS (SELECT match_id, participant_id, any_value(puuid) AS puuid, any_value(champion_id) AS champion_id, any_value(champion_name) AS champion_name, any_value(team_position) AS team_position, any_value(concat_ws('#', riot_id_game_name, riot_id_tagline)) AS riot_id FROM (",
    dimension,
    ") GROUP BY match_id, participant_id)",
  );
}

/** Whoever acted: the killer, else the participant, else the ward's creator. Slot 0 is not a player. */
const EVENT_ACTOR =
  "coalesce(nullif(m.killer_id, 0), nullif(m.participant_id, 0), nullif(m.creator_id, 0))";

/** One row per (match, team): whether that team won. */
function teamWinCte(teams: SqlFragment): SqlFragment {
  return seq(
    "team_win AS (SELECT match_id, team_id, any_value(win) AS win FROM (",
    teams,
    ") GROUP BY match_id, team_id)",
  );
}

/** One row per event: how many players were credited with an assist. */
/**
 * The assist scan's own filter: only the events the source scan kept, and
 * only assists. Unnarrowed, its dedupe window held every event participant
 * in the lake and ran out of memory at production size.
 */
export const EVENT_KEYS_SCAN_FILTER =
  "event_id IN (SELECT event_id FROM event_keys) AND role = 'assist'";

function eventKeysCte(events: SqlFragment): SqlFragment {
  return seq("event_keys AS (SELECT event_id FROM (", events, "))");
}

function assistCountsCte(participants: SqlFragment): SqlFragment {
  return seq(
    "assist_counts AS (SELECT event_id, count(*) AS assists FROM (",
    participants,
    ") GROUP BY event_id)",
  );
}

/**
 * The event scan with its first-of-kind flag, computed before any join or
 * filter so "first" means first in the match — not first among what a query
 * or a server scope happened to keep.
 */
function withFirstOfKind(events: SqlFragment): SqlFragment {
  return seq(
    "SELECT *, (row_number() OVER (PARTITION BY match_id, event_type, coalesce(monster_type, ''), coalesce(building_type, '') ORDER BY event_timestamp_ms, event_index) = 1) AS is_first_of_kind FROM (",
    events,
    ")",
  );
}

function eventLookups(input: FactsCteInput): Lookups {
  const matches = input.matchDimension;
  const participants = input.participantDimension;
  if (matches === undefined || participants === undefined) {
    throw new Error(
      "timeline_events compile requires match and participant dimensions.",
    );
  }
  const ctes = [matchDimensionCte(matches), actorDimensionCte(participants)];
  const joins = [
    " JOIN match_dim d ON d.match_id = m.match_id",
    ` LEFT JOIN actor_dim p ON p.match_id = m.match_id AND p.participant_id = ${EVENT_ACTOR}`,
  ];
  const items = [
    MATCH_DIMENSION_ITEMS,
    "p.champion_id AS champion_id, p.champion_name AS champion_name, p.team_position AS team_position",
  ];
  const lookups = input.eventLookups;
  if (lookups?.firstOfKind === true) {
    items.push("m.is_first_of_kind AS is_first_of_kind");
  }
  if (lookups?.killerTeam !== undefined) {
    ctes.push(teamWinCte(lookups.killerTeam));
    joins.push(
      " LEFT JOIN team_win kt ON kt.match_id = m.match_id AND kt.team_id = m.killer_team_id",
    );
    items.push("kt.win AS killer_team_won");
  }
  if (lookups?.assists !== undefined) {
    ctes.push(eventKeysCte(input.source), assistCountsCte(lookups.assists));
    joins.push(" LEFT JOIN assist_counts ac ON ac.event_id = m.event_id");
    items.push("coalesce(ac.assists, 0) AS assist_count");
  }
  return { ctes, joins: joins.join(""), items };
}

function rowLookups(input: FactsCteInput): Lookups {
  if (input.columnSource === "timeline-event") {
    return eventLookups(input);
  }
  const ctes: SqlFragment[] = [];
  const joins: string[] = [];
  const items: string[] = [];
  if (input.teamDimension !== undefined) {
    ctes.push(teamDimensionCte(input.teamDimension));
    joins.push(TEAM_LOOKUP_JOIN);
    items.push(TEAM_LOOKUP_ITEMS);
  }
  if (input.columnSource === "timeline-frame") {
    const participants = input.participantDimension;
    if (participants === undefined) {
      throw new Error(
        "timeline_frames compile requires a participant dimension.",
      );
    }
    ctes.push(participantDimensionCte(participants));
    joins.push(PARTICIPANT_JOIN);
    items.push(PARTICIPANT_ITEMS);
    const gold = input.frameGold;
    if (gold?.narrowed === true) {
      ctes.push(frameKeysCte(input.source));
    }
    if (gold?.team === true) {
      ctes.push(teamGoldCte(gold.source, gold.narrowed));
      joins.push(TEAM_GOLD_JOIN);
      items.push(TEAM_GOLD_DIFF);
    }
    if (gold?.lane === true) {
      ctes.push(laneGoldCte(gold.source, gold.narrowed));
      joins.push(LANE_GOLD_JOIN);
      items.push("(m.total_gold - lo.gold) AS lane_gold_diff");
    }
  }
  return { ctes, joins: joins.join(""), items };
}

const MATCH_DIMENSION_ITEMS =
  "d.game_creation_at AS game_creation_at, d.queue AS queue, d.patch AS patch, d.map_id AS map_id";

/**
 * The facts CTE: identity + puuid + every referenced source column over the
 * union source. Guild scope joins the server's accounts dimension; global
 * scope never joins it (re-adding the join would double-count accounts
 * tracked by more than one server).
 */
export function buildFactsCte(input: FactsCteInput): SqlFragment {
  const projected = input.projected
    .toSorted()
    .map((name) => `m.${name} AS ${name}`)
    .join(", ");
  const teamSource = readsMatchDimension(input.columnSource);
  const banSource = input.columnSource === "match-team-ban";
  const lookups: Lookups = teamSource
    ? { ctes: [], joins: "", items: [] }
    : rowLookups(input);
  const eventSource = input.columnSource === "timeline-event";
  // An event carries no puuid; its player's comes from the actor lookup.
  const puuidRef = eventSource ? "p.puuid" : "m.puuid";
  const rows =
    eventSource && input.eventLookups?.firstOfKind === true
      ? withFirstOfKind(input.source)
      : input.source;
  const items = joinFragments(
    [
      frag(identityProjection(input.scope, input.columnSource)),
      ...lookups.items.map((item) => frag(item)),
      // No puuid exists on a team row; the column is held open as NULL so the
      // facts shape does not vary by source.
      frag(teamSource ? "NULL::VARCHAR AS puuid" : `${puuidRef} AS puuid`),
      frag(projected),
      ...(teamSource ? [frag(MATCH_DIMENSION_ITEMS)] : []),
      ...(banSource ? [frag("cn.champion_name AS champion_name")] : []),
      ...input.extraItems,
    ],
    ", ",
  );
  if (teamSource) {
    return teamRowFacts(input, items);
  }
  const lookupCtes = lookups.ctes.flatMap((cte) => [cte, frag(", ")]);
  if (input.scope.kind === "global") {
    return seq(
      "WITH ",
      ...lookupCtes,
      "facts AS (SELECT ",
      items,
      " FROM (",
      rows,
      `) m${lookups.joins})`,
    );
  }
  const accountsParquet = input.files.accountsParquet;
  if (accountsParquet === undefined) {
    throw new Error(
      "compile called without accounts.parquet — caller must short-circuit",
    );
  }
  const accounts = buildAccountsSource(accountsParquet, input.scope.serverId);
  return seq(
    "WITH ",
    ...lookupCtes,
    "accounts AS (",
    accounts,
    "), facts AS (SELECT ",
    items,
    " FROM (",
    rows,
    // Lookups first: an event's player is only known once the actor is.
    `) m${lookups.joins} JOIN accounts a ON a.puuid = ${puuidRef})`,
  );
}
