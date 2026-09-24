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
    "WITH match_dim AS (SELECT match_id, any_value(game_creation_at) AS game_creation_at, any_value(queue) AS queue, any_value(",
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
  const team = input.teamDimension;
  const items = joinFragments(
    [
      frag(identityProjection(input.scope, input.columnSource)),
      ...(team === undefined ? [] : [frag(TEAM_LOOKUP_ITEMS)]),
      // No puuid exists on a team row; the column is held open as NULL so the
      // facts shape does not vary by source.
      frag(teamSource ? "NULL::VARCHAR AS puuid" : "m.puuid AS puuid"),
      frag(projected),
      ...(teamSource ? [frag(MATCH_DIMENSION_ITEMS)] : []),
      ...(banSource ? [frag("cn.champion_name AS champion_name")] : []),
      ...input.extraItems,
    ],
    ", ",
  );
  if (teamSource) {
    const dimension = input.matchDimension;
    if (dimension === undefined) {
      throw new Error("match_teams compile requires a match dimension.");
    }
    return seq(
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
  const teamCte =
    team === undefined ? frag("") : seq(teamDimensionCte(team), ", ");
  const teamJoin = team === undefined ? "" : TEAM_LOOKUP_JOIN;
  if (input.scope.kind === "global") {
    return seq(
      "WITH ",
      teamCte,
      "facts AS (SELECT ",
      items,
      " FROM (",
      input.source,
      `) m${teamJoin})`,
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
    teamCte,
    "accounts AS (",
    accounts,
    "), facts AS (SELECT ",
    items,
    " FROM (",
    input.source,
    `) m JOIN accounts a ON a.puuid = m.puuid${teamJoin})`,
  );
}
