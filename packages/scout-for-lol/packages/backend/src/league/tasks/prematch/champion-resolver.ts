import { getChampionName } from "twisted/dist/constants/champions.js";
import { normalizeChampionName } from "@scout-for-lol/data";

/**
 * Resolve a Riot champion ID to the champion key used for Data Dragon lookups.
 * Example: 1 → "Annie", 64 → "LeeSin"
 *
 * The key is what's used in file paths like "LeeSin_0.jpg" for loading screen art.
 */
export function resolveChampionKey(championId: number): string {
  try {
    const rawName = getChampionName(championId);
    if (!rawName || rawName === "") {
      return `Champion${championId.toString()}`;
    }

    // twisted returns SCREAMING_SNAKE_CASE like "LEE_SIN"
    // We need Data Dragon key format like "LeeSin"
    // Use normalizeChampionName for known overrides (e.g., FiddleSticks → Fiddlesticks)
    const parts = rawName.split("_");
    const pascalCase = parts
      .map(
        (part) =>
          part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
      )
      .join("");

    return normalizeChampionName(pascalCase);
  } catch {
    return `Champion${championId.toString()}`;
  }
}
