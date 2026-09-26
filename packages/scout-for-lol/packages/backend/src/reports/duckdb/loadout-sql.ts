import {
  reportLoadoutNames,
  type LoadoutNameKind,
} from "@scout-for-lol/data/model/reports/report-query-loadout.ts";
import { listParam, type SqlFragment } from "#src/reports/duckdb/lake.ts";
import { frag } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * The loadout name columns of a participant row — keystone, rune trees,
 * summoner spells and the final build — looked up from the bundled Data
 * Dragon names.
 *
 * Joined only when a query names one, and only the joins that column needs:
 * each join reads a loadout id, and a scan selects a loadout id only when the
 * query needs it (see MATCH_READ_COLUMNS), so a join for an unnamed column
 * would read a column the scan left out.
 */

type NameJoin = {
  alias: string;
  kind: LoadoutNameKind;
  /** The participant-row id column the name is looked up by. */
  idColumn: string;
};

const ITEM_JOINS: NameJoin[] = [0, 1, 2, 3, 4, 5].map((slot) => ({
  alias: `li${slot.toString()}`,
  kind: "item",
  idColumn: `item${slot.toString()}`,
}));

const SPELL1: NameJoin = {
  alias: "ls1",
  kind: "spell",
  idColumn: "summoner1_id",
};
const SPELL2: NameJoin = {
  alias: "ls2",
  kind: "spell",
  idColumn: "summoner2_id",
};
const SPELL_JOINS = [SPELL1, SPELL2];

/** In name order, so a pair or a build reads the same whatever slots held it. */
function sortedNames(joins: NameJoin[]): string {
  const names = joins.map((join) => `${join.alias}.name`).join(", ");
  return `array_to_string(list_sort([${names}]), ' + ')`;
}

const NAME_COLUMNS: Record<string, { joins: NameJoin[]; sql: string }> = {
  keystone: {
    joins: [{ alias: "lk", kind: "rune", idColumn: "perk0" }],
    sql: "lk.name",
  },
  primary_tree: {
    joins: [
      { alias: "lpt", kind: "rune_tree", idColumn: "perk_primary_style" },
    ],
    sql: "lpt.name",
  },
  secondary_tree: {
    joins: [{ alias: "lst", kind: "rune_tree", idColumn: "perk_sub_style" }],
    sql: "lst.name",
  },
  summoner1: { joins: [SPELL1], sql: "ls1.name" },
  summoner2: { joins: [SPELL2], sql: "ls2.name" },
  spells: { joins: SPELL_JOINS, sql: sortedNames(SPELL_JOINS) },
  items: { joins: ITEM_JOINS, sql: sortedNames(ITEM_JOINS) },
};

/** The name columns, each with the loadout ids it is looked up from. */
export const LOADOUT_NAME_DEPENDENCIES: ReadonlyMap<string, readonly string[]> =
  new Map(
    Object.entries(NAME_COLUMNS).map(([name, column]) => [
      name,
      column.joins.map((join) => join.idColumn),
    ]),
  );

export type LoadoutLookup = {
  cte: SqlFragment;
  joins: string;
  items: string[];
};

/**
 * The CTE, joins and facts items for the name columns a query names. Names
 * travel as bound lists zipped by DuckDB's parallel unnest, so no name is
 * ever written into SQL text.
 */
export function loadoutLookup(names: ReadonlySet<string>): LoadoutLookup {
  const entries = reportLoadoutNames();
  const joins = new Map<string, NameJoin>();
  const items: string[] = [];
  for (const [name, column] of Object.entries(NAME_COLUMNS)) {
    if (!names.has(name)) continue;
    for (const join of column.joins) joins.set(join.alias, join);
    items.push(`${column.sql} AS ${name}`);
  }
  return {
    cte: frag(
      "loadout_names AS (SELECT unnest(?) AS kind, unnest(?) AS id, unnest(?) AS name)",
      [
        listParam(entries.map((entry) => entry.kind)),
        listParam(entries.map((entry) => entry.id)),
        listParam(entries.map((entry) => entry.name)),
      ],
    ),
    joins: [...joins.values()]
      .map(
        (join) =>
          ` LEFT JOIN loadout_names ${join.alias} ON ${join.alias}.kind = '${join.kind}' AND ${join.alias}.id = m.${join.idColumn}`,
      )
      .join(""),
    items,
  };
}
