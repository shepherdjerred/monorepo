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

export type LoadoutNameKind = "rune" | "rune_tree" | "spell" | "item";

export type LoadoutName = { kind: LoadoutNameKind; id: number; name: string };

export function reportLoadoutNames(): LoadoutName[] {
  const trees = runes.map((tree): LoadoutName => ({
    kind: "rune_tree",
    id: tree.id,
    name: tree.name,
  }));
  const perks = runes.flatMap((tree) =>
    tree.slots.flatMap((slot) =>
      slot.runes.map((rune): LoadoutName => ({
        kind: "rune",
        id: rune.id,
        name: rune.name,
      })),
    ),
  );
  const spells = Object.values(summoner.data).map((spell): LoadoutName => ({
    kind: "spell",
    id: Number(spell.key),
    name: spell.name,
  }));
  const items = reportItemCatalog().map(({ rawId, item }): LoadoutName => ({
    kind: "item",
    id: rawId,
    name: item.name,
  }));
  return [...trees, ...perks, ...spells, ...items];
}
