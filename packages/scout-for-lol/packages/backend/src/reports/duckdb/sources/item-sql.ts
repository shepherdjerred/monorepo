import { ITEM_SLOT_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import { reportItemCatalog } from "@scout-for-lol/data/model/reports/report-query-items.ts";
import { listParam, type SqlFragment } from "#src/reports/duckdb/lake.ts";
import { frag } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * match_items: one row per item a player held when a match ended.
 *
 * A participant row carries its final inventory as seven slot columns; this
 * unpivots them, dropping empty slots (id 0), and names each item from the
 * bundled item data. The row's player is an ordinary match_participants row,
 * so scope, identity and pushed filters are exactly that source's, and a
 * filter on the item applies after the unpivot.
 */

/**
 * Item names and tiers by the id a lake row carries, as bound lists zipped
 * by DuckDB's parallel unnest, so no name is ever written into SQL text. A
 * mode's reissue of an item maps to its base id.
 */
export function itemNamesCte(): SqlFragment {
  const catalog = reportItemCatalog();
  return frag(
    "item_names AS (SELECT unnest(?) AS raw_id, unnest(?) AS item_id, unnest(?) AS item, unnest(?) AS item_tier)",
    [
      listParam(catalog.map((entry) => entry.rawId)),
      listParam(catalog.map((entry) => entry.item.id)),
      listParam(catalog.map((entry) => entry.item.name)),
      listParam(catalog.map((entry) => entry.item.tier)),
    ],
  );
}

const SLOTS = ITEM_SLOT_COLUMNS.map((column) => `m.${column}`).join(", ");

/**
 * An item newer than the bundled data keeps its raw id and has no name or
 * tier: NULL, which groups as 'unknown', rather than a guess.
 */
export const ITEM_JOIN = ` JOIN LATERAL (SELECT unnest([${SLOTS}]) AS raw_item_id, unnest(range(${ITEM_SLOT_COLUMNS.length.toString()})) AS slot) i ON i.raw_item_id > 0 LEFT JOIN item_names n ON n.raw_id = i.raw_item_id`;

export const ITEM_ITEMS =
  "coalesce(n.item_id, i.raw_item_id) AS item_id, n.item AS item, n.item_tier AS item_tier, i.slot::INTEGER AS slot";
