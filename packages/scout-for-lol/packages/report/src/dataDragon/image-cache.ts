import {
  getChampionImageBase64,
  getChampionLoadingImageBase64,
  getChampionSplashImageBase64,
  getItemImageBase64,
  getSpellImageBase64,
  getAugmentIconBase64,
  normalizeChampionName,
  summoner,
  items,
  type SkinFallbackEvent,
} from "@scout-for-lol/data";

// Centralized image cache for Satori rendering
// Images are loaded as base64 data URIs for deterministic SVG output

// Champion image cache
const championImageCache = new Map<string, string>();

// Item image cache
const itemImageCache = new Map<number, string>();

// Spell image cache
const spellImageCache = new Map<string, string>();

// Augment icon cache
const augmentIconCache = new Map<string, string>();

// Champion loading screen image cache (key: "{ChampionName}_{skinNum}").
// Pre-loaded into a sync-accessible Map because satori renders JSX
// synchronously — it cannot do async file reads during render.
const championLoadingImageCache = new Map<string, string>();

// Champion splash-art image cache (key: "{ChampionName}_{skinNum}"). High-res
// landscape art used by the ranked report designs' full-bleed hero background.
const championSplashImageCache = new Map<string, string>();

// Pre-load spell images at module load time (static set)
if (typeof Bun !== "undefined") {
  const spellNames = Object.keys(summoner.data);
  await Promise.all(
    spellNames.map(async (spellName) => {
      const spellData = summoner.data[spellName];
      if (spellData) {
        const base64 = await getSpellImageBase64(spellData.image.full);
        spellImageCache.set(spellData.image.full, base64);
      }
    }),
  );
}

// Pre-load item images at module load time (static set)
if (typeof Bun !== "undefined") {
  const itemIds = Object.keys(items.data).map((id) => Number.parseInt(id, 10));
  await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        const base64 = await getItemImageBase64(itemId);
        itemImageCache.set(itemId, base64);
      } catch {
        // Some items may not have images, skip them
      }
    }),
  );
}

// Placeholder data URI used when getItemImage is called for an item id
// outside the bundled Data Dragon snapshot (Riot ships new items every
// patch). Pre-loaded at module init so renders stay synchronous.
let placeholderItemDataUri = "";
if (typeof Bun !== "undefined") {
  const bytes = await Bun.file(
    new URL("../assets/placeholder-icon.svg", import.meta.url),
  ).bytes();
  placeholderItemDataUri = `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
}

// Optional callback fired when getItemImage falls back to the placeholder.
// Set via setItemMissHandler from the backend so we can log + meter the
// event without coupling the report package to prom-client.
export type ItemMissEvent = { itemId: number };
let onItemMissHandler: ((event: ItemMissEvent) => void) | undefined;
export function setItemMissHandler(
  handler: (event: ItemMissEvent) => void,
): void {
  onItemMissHandler = handler;
}

// Get champion image from cache (must be pre-loaded via preloadChampionImages).
// Normalizes the lookup key so any casing variant Riot ever sends
// ("FiddleSticks", "FIDDLESTICKS", etc.) resolves to the canonical entry.
export function getChampionImage(championName: string): string {
  const key = normalizeChampionName(championName);
  const cached = championImageCache.get(key);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }
  throw new Error(
    `Champion image for ${key} not found in cache. Call preloadChampionImages() before rendering.`,
  );
}

// Get item image from cache. On miss (Riot shipped a new item between Data
// Dragon refreshes), returns a "?" placeholder data URI rather than an
// empty string — satori throws "Image source is not provided." on empty
// src, which previously crashed the entire match report. Stale icon is
// recoverable on the next refresh; a perpetual render crash burned the
// AI pipeline on every poll for the affected match.
//
// Item ID 0 (empty slot) is handled by the renderer (item.tsx renders an
// empty div) and never reaches this function, so the placeholder return
// only fires for genuine cache misses.
export function getItemImage(itemId: number): string {
  const cached = itemImageCache.get(itemId);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }
  onItemMissHandler?.({ itemId });
  return placeholderItemDataUri;
}

// Get spell image from cache
export function getSpellImage(spellImageName: string): string {
  const cached = spellImageCache.get(spellImageName);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }
  throw new Error(`Spell image ${spellImageName} not found in cache.`);
}

// Get augment icon from cache (must be pre-loaded via preloadAugmentIcons)
export function getAugmentIcon(augmentIconPath: string): string {
  const cached = augmentIconCache.get(augmentIconPath);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }
  throw new Error(
    `Augment icon ${augmentIconPath} not found in cache. Call preloadAugmentIcons() before rendering.`,
  );
}

// Pre-load champion images for a list of champion names. Each name is
// normalized so cache hits work regardless of the casing the caller passed.
export async function preloadChampionImages(
  championNames: string[],
): Promise<void> {
  const uniqueKeys = [
    ...new Set(championNames.map((name) => normalizeChampionName(name))),
  ];
  await Promise.all(
    uniqueKeys.map(async (key) => {
      if (!championImageCache.has(key)) {
        const base64 = await getChampionImageBase64(key);
        championImageCache.set(key, base64);
      }
    }),
  );
}

// Pre-load augment icons for a list of icon paths
export async function preloadAugmentIcons(iconPaths: string[]): Promise<void> {
  const uniquePaths = [...new Set(iconPaths)];
  await Promise.all(
    uniquePaths.map(async (iconPath) => {
      if (!augmentIconCache.has(iconPath)) {
        const base64 = await getAugmentIconBase64(iconPath);
        augmentIconCache.set(iconPath, base64);
      }
    }),
  );
}

// Get champion loading screen image from cache (must be pre-loaded).
// Normalizes the champion-name component of the cache key so casing
// variants resolve to the canonical entry.
export function getChampionLoadingImage(
  championName: string,
  skinNum: number,
): string {
  const key = `${normalizeChampionName(championName)}_${skinNum.toString()}`;
  const cached = championLoadingImageCache.get(key);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }

  throw new Error(
    `Champion loading image for ${key} not found in cache. Call preloadChampionLoadingImages() before rendering.`,
  );
}

// Pre-load champion loading screen images for a list of champion/skin combos.
// Chromas are resolved to their parent skin via resolveLoadingSkinNum at the
// caller. If a requested skin's JPG is missing on disk (e.g. Riot just shipped
// a new skin and we haven't refreshed assets), the loader silently falls back
// to skin 0; pass `onSkinFallback` to log/meter those events.
//
// The fallback base64 is cached under the *requested* `${champion}_${skinNum}`
// key so repeat renders within the same run hit the cache instead of doing
// the FS-existence check again.
// Shared preload driver for the tall (loading) and wide (splash) champion-art
// caches — both dedupe on the normalized `${champion}_${skinNum}` key, skip
// already-cached keys, and cache the base64 under the *requested* key so a
// skin-fallback result still hits the cache on repeat renders.
async function preloadChampionArt(
  cache: Map<string, string>,
  loadBase64: (
    championName: string,
    skinNum: number,
    onSkinFallback?: (event: SkinFallbackEvent) => void,
  ) => Promise<string>,
  entries: { championName: string; skinNum: number }[],
  onSkinFallback?: (event: SkinFallbackEvent) => void,
): Promise<void> {
  const seen = new Set<string>();
  const uniqueEntries = entries
    .map(({ championName, skinNum }) => ({
      championName: normalizeChampionName(championName),
      skinNum,
    }))
    .filter((entry) => {
      const key = `${entry.championName}_${entry.skinNum.toString()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  await Promise.all(
    uniqueEntries.map(async ({ championName, skinNum }) => {
      const key = `${championName}_${skinNum.toString()}`;
      if (cache.has(key)) {
        return;
      }
      const base64 = await loadBase64(championName, skinNum, onSkinFallback);
      cache.set(key, base64);
    }),
  );
}

export async function preloadChampionLoadingImages(
  entries: { championName: string; skinNum: number }[],
  onSkinFallback?: (event: SkinFallbackEvent) => void,
): Promise<void> {
  await preloadChampionArt(
    championLoadingImageCache,
    getChampionLoadingImageBase64,
    entries,
    onSkinFallback,
  );
}

// Get champion splash-art image from cache (must be pre-loaded via
// preloadChampionSplashImages). Normalizes the champion-name component of the
// cache key so casing variants resolve to the canonical entry.
export function getChampionSplashImage(
  championName: string,
  skinNum: number,
): string {
  const key = `${normalizeChampionName(championName)}_${skinNum.toString()}`;
  const cached = championSplashImageCache.get(key);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }

  throw new Error(
    `Champion splash image for ${key} not found in cache. Call preloadChampionSplashImages() before rendering.`,
  );
}

// Pre-load champion splash-art images for a list of champion/skin combos. Only
// base skin 0 is cached on disk (see getChampionSplashImageBase64), so a
// non-zero skin's base64 falls back to skin 0 and is cached under the
// *requested* key so repeat renders within the same run hit the cache.
export async function preloadChampionSplashImages(
  entries: { championName: string; skinNum: number }[],
  onSkinFallback?: (event: SkinFallbackEvent) => void,
): Promise<void> {
  await preloadChampionArt(
    championSplashImageCache,
    getChampionSplashImageBase64,
    entries,
    onSkinFallback,
  );
}
