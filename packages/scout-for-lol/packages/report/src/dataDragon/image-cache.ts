import {
  getChampionImageBase64,
  getChampionLoadingImageBase64,
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

// Get item image from cache
export function getItemImage(itemId: number): string {
  const cached = itemImageCache.get(itemId);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }
  // Return empty for missing items (item ID 0 means empty slot)
  if (itemId === 0) {
    return "";
  }
  throw new Error(`Item image for ${itemId.toString()} not found in cache.`);
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
export async function preloadChampionLoadingImages(
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
      if (championLoadingImageCache.has(key)) {
        return;
      }
      const base64 = await getChampionLoadingImageBase64(
        championName,
        skinNum,
        onSkinFallback,
      );
      championLoadingImageCache.set(key, base64);
    }),
  );
}
