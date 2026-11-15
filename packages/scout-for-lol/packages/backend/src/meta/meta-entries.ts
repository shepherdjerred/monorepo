import { ENEMY_TRAITS } from "#src/report-lake/crawl/meta-partials.ts";
import type { MetaPartialKind } from "#src/report-lake/crawl/meta-partials.ts";
import type { ChampionSlice } from "#src/meta/meta-serving.ts";
import { wilsonInterval } from "#src/meta/wilson.ts";

/**
 * The per-slice entry lists of the serving JSON (core items, builds, runes,
 * spells, skill orders, item lift), built from a slice's summed partial rows.
 * Pure; the minimum samples were already applied by the roll-up query.
 */

/** One partial row summed over the retained days and a rank bracket. */
export type RollupRow = {
  kind: MetaPartialKind;
  patch: string;
  queue_id: number;
  bracket: string;
  role: string;
  champion_id: number;
  key1: string;
  key2: string;
  games: number;
  wins: number;
  /** Games summed over every entry of this row's kind in its slice. */
  kind_total: number;
};

const CORE_ITEM_LIMIT = 12;
const BUILD_PATH_LIMIT = 8;
const START_ITEM_LIMIT = 6;
const RUNE_LIMIT = 6;
const SPELL_LIMIT = 4;
const SKILL_ORDER_LIMIT = 4;
const LIFT_ITEM_LIMIT = 10;

function counted(games: number, wins: number, denominator: number) {
  return {
    games,
    wins,
    winRate: wilsonInterval(wins, games),
    share: wilsonInterval(games, Math.max(denominator, games)),
  };
}

function byGamesThenKey<T extends { games: number }>(
  entries: readonly (readonly [string, T])[],
): T[] {
  return entries
    .toSorted(
      ([leftKey, left], [rightKey, right]) =>
        right.games - left.games || leftKey.localeCompare(rightKey),
    )
    .map(([, value]) => value);
}

function ids(text: string): number[] {
  return text === "" ? [] : text.split(/[,>]/u).map(Number);
}

function parseStartItems(key: string) {
  return key.split("+").map((part) => {
    const [itemId = "", count = "1"] = part.split("x");
    return { itemId: Number(itemId), count: Number(count) };
  });
}

function parseRune(key1: string, key2: string) {
  const [primary = "", primaryPerks = ""] = key1.split(":");
  const [secondary = "", secondaryPerks = ""] = key2.split(":");
  return {
    primaryStyleId: Number(primary),
    primaryPerkIds: ids(primaryPerks),
    secondaryStyleId: Number(secondary),
    secondaryPerkIds: ids(secondaryPerks),
  };
}

export type SliceRows = Map<MetaPartialKind, RollupRow[]>;
function itemLiftOf(rows: SliceRows): ChampionSlice["itemLift"] {
  const baselines = new Map(
    (rows.get("trait_base") ?? []).map((entry) => [entry.key2, entry]),
  );
  return ENEMY_TRAITS.flatMap((trait) => {
    const baseline = baselines.get(trait);
    if (baseline === undefined || baseline.games === 0) return [];
    const baselineRate = wilsonInterval(baseline.wins, baseline.games);
    const items = (rows.get("item_trait") ?? [])
      .filter((entry) => entry.key2 === trait)
      .map((entry) => {
        const rate = wilsonInterval(entry.wins, entry.games);
        return {
          itemId: Number(entry.key1),
          games: entry.games,
          wins: entry.wins,
          winRate: rate,
          lift: rate.value - baselineRate.value,
          significant:
            rate.lower > baselineRate.value || rate.upper < baselineRate.value,
        };
      })
      .toSorted(
        (left, right) => right.lift - left.lift || left.itemId - right.itemId,
      )
      .slice(0, LIFT_ITEM_LIMIT);
    if (items.length === 0) return [];
    return [
      {
        trait,
        baseline: {
          games: baseline.games,
          wins: baseline.wins,
          winRate: baselineRate,
        },
        items,
      },
    ];
  });
}

export type SliceEntries = Pick<
  ChampionSlice,
  | "coreItems"
  | "buildPaths"
  | "startingItems"
  | "runes"
  | "spells"
  | "skillOrders"
  | "itemLift"
>;

export function entriesOf(rows: SliceRows, sliceGames: number): SliceEntries {
  const of = (kind: MetaPartialKind) => rows.get(kind) ?? [];
  return {
    coreItems: byGamesThenKey(
      of("item").map((entry) => [
        entry.key1,
        {
          itemId: Number(entry.key1),
          ...counted(entry.games, entry.wins, sliceGames),
          denominator: "slice_games" as const,
        },
      ]),
    ).slice(0, CORE_ITEM_LIMIT),
    buildPaths: byGamesThenKey(
      of("build_path").map((entry) => [
        entry.key1,
        {
          itemIds: ids(entry.key1),
          ...counted(entry.games, entry.wins, entry.kind_total),
          denominator: "games_with_timeline" as const,
        },
      ]),
    ).slice(0, BUILD_PATH_LIMIT),
    startingItems: byGamesThenKey(
      of("start_items").map((entry) => [
        entry.key1,
        {
          items: parseStartItems(entry.key1),
          ...counted(entry.games, entry.wins, entry.kind_total),
          denominator: "games_with_timeline" as const,
        },
      ]),
    ).slice(0, START_ITEM_LIMIT),
    runes: byGamesThenKey(
      of("rune").map((entry) => [
        `${entry.key1}/${entry.key2}`,
        {
          ...parseRune(entry.key1, entry.key2),
          ...counted(entry.games, entry.wins, entry.kind_total),
          denominator: "games_with_runes" as const,
        },
      ]),
    ).slice(0, RUNE_LIMIT),
    spells: byGamesThenKey(
      of("spells").map((entry) => [
        entry.key1,
        {
          spellIds: ids(entry.key1),
          ...counted(entry.games, entry.wins, entry.kind_total),
          denominator: "slice_games" as const,
        },
      ]),
    ).slice(0, SPELL_LIMIT),
    skillOrders: byGamesThenKey(
      of("skill_order").map((entry) => [
        entry.key1,
        {
          order: entry.key1,
          ...counted(entry.games, entry.wins, entry.kind_total),
          denominator: "games_with_timeline" as const,
        },
      ]),
    ).slice(0, SKILL_ORDER_LIMIT),
    itemLift: itemLiftOf(rows),
  };
}
