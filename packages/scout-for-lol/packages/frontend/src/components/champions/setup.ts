import type { ChampionSlice } from "#src/lib/champion-meta/snapshot.ts";
import {
  abilityAsset,
  abilitySlot,
  itemAsset,
  itemName,
  runeAsset,
  runeName,
  runeTreeName,
  spellAsset,
  spellName,
  type CatalogAsset,
} from "#src/components/champions/catalog.ts";

/**
 * What the champion page shows of a slice's setups: the most played of each,
 * as rows of icons with the win rate and games behind them, and the next few
 * as one line each. Rates are percent, as the design-system rows take them.
 */

export type SetupItemModel = {
  label: string;
  asset: CatalogAsset;
  keystone?: boolean;
  breakAfter?: boolean;
};

export type SetupRowModel = {
  title: string;
  items: SetupItemModel[];
  sequence: boolean;
  note?: string;
  proof: { winRate: number; games: number; pickRate?: number };
};

export type AlternativeModel = {
  text: string;
  winRate: number;
  games: number;
};

export type AlternativesModel = {
  summary: string;
  entries: AlternativeModel[];
};

/** Alternatives each fold lists after the setup the row shows. */
const ALTERNATIVES_SHOWN = 3;

type Counted = { games: number; winRate: { value: number } };

function mostPlayed<T extends Counted>(entries: readonly T[]): T[] {
  return entries.toSorted((a, b) => b.games - a.games);
}

function percent(rate: number): number {
  return rate * 100;
}

function proofOf(entry: Counted): SetupRowModel["proof"] {
  return { winRate: percent(entry.winRate.value), games: entry.games };
}

/** "2 Health Potions": the count in front, the name pluralised. */
export function countedName(name: string, count: number): string {
  return count > 1 ? `${count.toString()} ${name}s` : name;
}

type RunePage = ChampionSlice["runes"][number];

/** The keystone is the first perk of the primary tree. */
function keystoneOf(page: RunePage): number {
  const [keystone] = page.primaryPerkIds;
  if (keystone === undefined) {
    throw new Error("A rune page names a keystone");
  }
  return keystone;
}

function runeItems(page: RunePage): SetupItemModel[] {
  const primary = page.primaryPerkIds.map((id, position): SetupItemModel => ({
    label: runeName(id),
    asset: runeAsset(id),
    keystone: position === 0,
    breakAfter: position === page.primaryPerkIds.length - 1,
  }));
  const secondary = page.secondaryPerkIds.map((id): SetupItemModel => ({
    label: runeName(id),
    asset: runeAsset(id),
  }));
  return [...primary, ...secondary];
}

function runeNote(page: RunePage): string {
  return `${runeTreeName(page.primaryStyleId)}, with ${runeTreeName(page.secondaryStyleId)} second`;
}

function spellItems(spellIds: readonly number[]): SetupItemModel[] {
  return spellIds.map((id) => ({
    label: spellName(id),
    asset: spellAsset(id),
  }));
}

type StartingSet = ChampionSlice["startingItems"][number];

function startingItems(set: StartingSet): SetupItemModel[] {
  return set.items.map((entry) => ({
    label: countedName(itemName(entry.itemId), entry.count),
    asset: itemAsset(entry.itemId),
  }));
}

/** The ability letters of a skill order such as "QWE". */
function slotLetters(order: string): string[] {
  // The orders are the ASCII letters Q, W and E.
  return order.split("");
}

/** Q, W and E in the order they are maxed: "Q first", "then W", "then E". */
function skillItems(championId: number, order: string): SetupItemModel[] {
  return slotLetters(order).map((letter, position) => ({
    label: position === 0 ? `${letter} first` : `then ${letter}`,
    asset: abilityAsset(championId, abilitySlot(letter)),
  }));
}

function buildItems(itemIds: readonly number[]): SetupItemModel[] {
  return itemIds.map((id) => ({ label: itemName(id), asset: itemAsset(id) }));
}

/** The rows of "How most people play": one per setup the slice has. */
export function setupRows(
  championId: number,
  slice: ChampionSlice,
): SetupRowModel[] {
  const rows: SetupRowModel[] = [];
  const [runes] = mostPlayed(slice.runes);
  if (runes !== undefined) {
    rows.push({
      title: "Runes",
      items: runeItems(runes),
      sequence: false,
      note: runeNote(runes),
      proof: proofOf(runes),
    });
  }
  const [spells] = mostPlayed(slice.spells);
  if (spells !== undefined) {
    rows.push({
      title: "Summoner spells",
      items: spellItems(spells.spellIds),
      sequence: false,
      proof: proofOf(spells),
    });
  }
  const [starting] = mostPlayed(slice.startingItems);
  if (starting !== undefined) {
    rows.push({
      title: "Starting items",
      items: startingItems(starting),
      sequence: false,
      proof: proofOf(starting),
    });
  }
  const [skills] = mostPlayed(slice.skillOrders);
  if (skills !== undefined) {
    rows.push({
      title: "Skill order",
      items: skillItems(championId, skills.order),
      sequence: true,
      proof: proofOf(skills),
    });
  }
  const [build] = mostPlayed(slice.buildPaths);
  if (build !== undefined) {
    rows.push({
      title: "Core build",
      items: buildItems(build.itemIds),
      sequence: true,
      proof: proofOf(build),
    });
  }
  return rows;
}

function alternatives<T extends Counted>(
  summary: string,
  entries: readonly T[],
  describe: (entry: T) => string,
): AlternativesModel | null {
  const rest = mostPlayed(entries).slice(1, 1 + ALTERNATIVES_SHOWN);
  if (rest.length === 0) return null;
  return {
    summary,
    entries: rest.map((entry) => ({
      text: describe(entry),
      winRate: percent(entry.winRate.value),
      games: entry.games,
    })),
  };
}

function listed(names: readonly string[]): string {
  return names.length < 3
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** The folds under "Other options": the next most played of each setup. */
export function otherOptions(slice: ChampionSlice): AlternativesModel[] {
  const folds = [
    alternatives(
      "Other rune pages",
      slice.runes,
      (page) =>
        `${runeName(keystoneOf(page))}, ${runeTreeName(page.primaryStyleId)}, with ${listed(page.secondaryPerkIds.map((id) => runeName(id)))}`,
    ),
    alternatives("Other spells", slice.spells, (pair) =>
      listed(pair.spellIds.map((id) => spellName(id))),
    ),
    alternatives("Other starting items", slice.startingItems, (set) =>
      listed(
        set.items.map((entry) =>
          countedName(itemName(entry.itemId), entry.count),
        ),
      ),
    ),
    alternatives("Other skill orders", slice.skillOrders, (skills) =>
      slotLetters(skills.order)
        .map((letter, position) => (position === 0 ? letter : `then ${letter}`))
        .join(", "),
    ),
    alternatives("Other builds", slice.buildPaths, (build) =>
      build.itemIds.map((id) => itemName(id)).join(", "),
    ),
  ];
  return folds.filter((fold) => fold !== null);
}
