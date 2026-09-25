import { items } from "#src/data-dragon/item.ts";

/**
 * Items as ScoutQL names them: `item('Infinity Edge')`, and the item and
 * tier columns of match_items.
 *
 * From the bundled Data Dragon snapshot, so an item added after it has no
 * name and an old patch's item may be classed by today's recipe. Game modes
 * reissue items under six-digit ids (Arena's Infinity Edge is 223031); a
 * variant with its base item's name folds to the base id, so one name means
 * one item across modes.
 */

export type ItemTier =
  | "starter"
  | "basic"
  | "epic"
  | "legendary"
  | "boots"
  | "consumable"
  | "trinket"
  | "other";

export type ReportItem = { id: number; name: string; tier: ItemTier };

type ItemData = (typeof items.data)[string];

/**
 * A finished item builds into nothing. Most build from components; the
 * transforms (Muramana, Seraph's) build from nothing and are told apart from
 * starters by price.
 */
const LEGENDARY_GOLD = 2000;
/** Starters (Doran's, support and jungle starters) are cheap and build from nothing. */
const STARTER_GOLD = 500;

function tierOf(item: ItemData): ItemTier {
  const tags = new Set(item.tags);
  if (tags.has("Trinket")) return "trinket";
  if (tags.has("Consumable")) return "consumable";
  if (tags.has("Boots")) return "boots";
  const builds = (item.into ?? []).length > 0;
  const buildsFrom = (item.from ?? []).length > 0;
  if (!builds && (buildsFrom || item.gold.total >= LEGENDARY_GOLD)) {
    return "legendary";
  }
  if (buildsFrom && builds) return "epic";
  if (builds) return "basic";
  return !buildsFrom && item.gold.total <= STARTER_GOLD ? "starter" : "other";
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

const MODE_VARIANT_MIN_ID = 100_000;

/** Every item id, with the base id a mode variant folds to. */
function buildCatalog(): { byId: Map<number, ReportItem>; all: ReportItem[] } {
  const byId = new Map<number, ReportItem>();
  const entries = Object.entries(items.data)
    .map(([key, item]) => ({ id: Number(key), item }))
    .toSorted((left, right) => left.id - right.id);
  for (const { id, item } of entries) {
    const baseId = id >= MODE_VARIANT_MIN_ID ? id % 10_000 : undefined;
    const base = baseId === undefined ? undefined : items.data[String(baseId)];
    const sameItem =
      base !== undefined &&
      baseId !== undefined &&
      normalizeName(base.name) === normalizeName(item.name);
    byId.set(
      id,
      sameItem
        ? { id: baseId, name: base.name, tier: tierOf(base) }
        : { id, name: item.name, tier: tierOf(item) },
    );
  }
  return { byId, all: [...byId.values()] };
}

const catalog = buildCatalog();

/** The first (lowest) id under each name, which item('…') folds to. */
const itemByName = new Map<string, ReportItem>();
for (const item of catalog.all) {
  const key = normalizeName(item.name);
  if (!itemByName.has(key)) itemByName.set(key, item);
}

/**
 * Every raw item id Scout may see with the item it counts as: the id a
 * lake row carries, and the base id, name and tier it folds to.
 */
export function reportItemCatalog(): { rawId: number; item: ReportItem }[] {
  return [...catalog.byId.entries()].map(([rawId, item]) => ({ rawId, item }));
}

export function resolveReportItem(name: string): ReportItem | undefined {
  return itemByName.get(normalizeName(name));
}

export function closestItemName(name: string): string | undefined {
  const normalized = normalizeName(name);
  let best: { name: string; distance: number } | undefined;
  for (const candidate of itemByName.values()) {
    const distance = editDistance(normalized, normalizeName(candidate.name));
    if (best === undefined || distance < best.distance) {
      best = { name: candidate.name, distance };
    }
  }
  const threshold = Math.max(2, Math.floor(normalized.length / 3));
  return best !== undefined && best.distance <= threshold
    ? best.name
    : undefined;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[rightIndex] ?? 0) + 1,
          (current[rightIndex - 1] ?? 0) + 1,
          (previous[rightIndex - 1] ?? 0) + cost,
        ),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}
