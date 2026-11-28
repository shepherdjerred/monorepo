import type { ChampionSlice } from "#src/lib/champion-meta/snapshot.ts";
import {
  itemAsset,
  itemName,
  type CatalogAsset,
} from "#src/components/champions/catalog.ts";

/**
 * "Later in the game": win rate by game length, what is usually bought after
 * the core, and the boots. A figure the slice did not serve is left out, never
 * estimated.
 */

export type LengthRow = {
  label: string;
  winRate: number;
  games: number;
};

export type LaterItem = { label: string; asset: CatalogAsset };

export type BootsModel = LaterItem & { share: number; games: number };

export type LaterModel = {
  headline: string | null;
  lengths: LengthRow[];
  afterCore: LaterItem[];
  boots: BootsModel | null;
};

const LENGTH_LABELS = {
  lt25: "Under 25 minutes",
  "25to35": "25 to 35 minutes",
  gt35: "Over 35 minutes",
} as const;

const LENGTH_ORDER = ["lt25", "25to35", "gt35"] as const;

/** Items listed after the core. */
const AFTER_CORE_SHOWN = 3;

type Duration = NonNullable<ChampionSlice["durations"]>[number];

/**
 * A plain statement only when the two ends of the game disagree beyond doubt:
 * the shortest games' interval clears the longest games' interval.
 */
function headlineOf(durations: readonly Duration[]): string | null {
  const short = durations.find((entry) => entry.bucket === "lt25");
  const long = durations.find((entry) => entry.bucket === "gt35");
  if (short === undefined || long === undefined) return null;
  if (short.winRate.lower > long.winRate.upper)
    return "Better in shorter games";
  return long.winRate.lower > short.winRate.upper
    ? "Better in longer games"
    : null;
}

export function laterModel(slice: ChampionSlice): LaterModel {
  const durations = slice.durations ?? [];
  const lengths = LENGTH_ORDER.flatMap((bucket) => {
    const entry = durations.find((candidate) => candidate.bucket === bucket);
    return entry === undefined
      ? []
      : [
          {
            label: LENGTH_LABELS[bucket],
            winRate: entry.winRate.value * 100,
            games: entry.games,
          },
        ];
  });
  const afterCore = (slice.itemsAfterCore ?? [])
    .toSorted((a, b) => b.games - a.games)
    .slice(0, AFTER_CORE_SHOWN)
    .map((entry) => ({
      label: itemName(entry.itemId),
      asset: itemAsset(entry.itemId),
    }));
  const [topBoots] = (slice.boots ?? []).toSorted((a, b) => b.games - a.games);
  return {
    headline: headlineOf(durations),
    lengths,
    afterCore,
    boots:
      topBoots === undefined
        ? null
        : {
            label: itemName(topBoots.itemId),
            asset: itemAsset(topBoots.itemId),
            share: topBoots.share.value * 100,
            games: topBoots.games,
          },
  };
}

export function hasLater(model: LaterModel): boolean {
  return (
    model.lengths.length > 0 ||
    model.afterCore.length > 0 ||
    model.boots !== null
  );
}
