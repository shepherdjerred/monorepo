import { runes } from "#src/data-dragon/runes.ts";
import { summoner } from "#src/data-dragon/summoner.ts";
import { reportItemCatalog } from "#src/model/reports/report-query-items.ts";

/**
 * Display names for the loadout ids a lake row carries — runes, rune trees,
 * summoner spells and items — as ScoutQL's name columns read them.
 *
 * From the bundled Data Dragon snapshot. An id missing from it (a rune or
 * item newer than the snapshot) has no entry, and its column reads NULL,
 * which groups as 'unknown', never a guess.
 */

export type LoadoutNameKind =
  | "rune"
  | "rune_tree"
  | "spell"
  | "item"
  /** Completed items only — what `core_items` names a build by. */
  | "core_item"
  | "boots_item";

export type LoadoutName = {
  kind: LoadoutNameKind;
  id: number;
  name: string;
  /** Canonical key used by the generated browser asset manifest. */
  assetKey: string | number;
};

export function reportLoadoutNames(): LoadoutName[] {
  const trees = runes.map((tree): LoadoutName => ({
    kind: "rune_tree",
    id: tree.id,
    name: tree.name,
    assetKey: tree.icon
      .slice(tree.icon.lastIndexOf("/") + 1)
      .replace(/\.png$/u, ""),
  }));
  const perks = runes.flatMap((tree) =>
    tree.slots.flatMap((slot) =>
      slot.runes.map((rune): LoadoutName => ({
        kind: "rune",
        id: rune.id,
        name: rune.name,
        assetKey: rune.icon
          .slice(rune.icon.lastIndexOf("/") + 1)
          .replace(/\.png$/u, ""),
      })),
    ),
  );
  const spells = Object.values(summoner.data).map((spell): LoadoutName => ({
    kind: "spell",
    id: Number(spell.key),
    name: spell.name,
    assetKey: spell.id,
  }));
  const items = reportItemCatalog().map(({ rawId, item }): LoadoutName => ({
    kind: "item",
    id: rawId,
    name: item.name,
    assetKey: rawId,
  }));
  // The same items again under the tiers a build is named by, so `core_items`
  // and `boots` can drop starters, consumables and components with a join
  // rather than by guessing from a name.
  const tiered = reportItemCatalog().flatMap(
    ({ rawId, item }): LoadoutName[] =>
      item.tier === "legendary" || item.tier === "boots"
        ? [
            {
              kind: item.tier === "legendary" ? "core_item" : "boots_item",
              id: rawId,
              name: item.name,
              assetKey: rawId,
            },
          ]
        : [],
  );
  return [...trees, ...perks, ...spells, ...items, ...tiered];
}
