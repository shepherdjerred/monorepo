import {
  getChampionDisplayName as getChampionDisplayNameFromRegistry,
  getChampionIdByName,
  resolveChampionKey as resolveChampionKeyFromRegistry,
  searchChampions as searchChampionsFromRegistry,
  getAllChampions as getAllChampionsFromRegistry,
  type ChampionId,
} from "@scout-for-lol/data";

/**
 * Get champion ID from champion name (case-insensitive, handles aliases and spaces/underscores).
 *
 * @param name Champion name (e.g., "yasuo", "Yasuo", "YASUO", "Twisted Fate", "twisted_fate")
 * @returns Champion ID or undefined if not found
 */
export function getChampionId(name: string): ChampionId | undefined {
  return getChampionIdByName(name);
}

/**
 * Get the human display name for a champion by id, e.g. "Twisted Fate",
 * "Vel'Koz", "Wukong", "Locke".
 *
 * @param championId Champion ID
 */
export function getChampionDisplayName(championId: number): string {
  return getChampionDisplayNameFromRegistry(championId);
}

/**
 * Search for champions by name prefix or substring.
 * Returns array of {name, id} sorted by relevance (used for autocomplete in Discord commands).
 *
 * @param query Search query (partial champion name)
 * @param limit Maximum number of results (default: 25, Discord limit)
 */
export function searchChampions(
  query: string,
  limit = 25,
): { name: string; id: number }[] {
  return searchChampionsFromRegistry(query, limit);
}

/**
 * Get all champions as an array sorted alphabetically by display name.
 */
export function getAllChampions(): { name: string; id: number }[] {
  return getAllChampionsFromRegistry().map((c) => ({
    name: c.name,
    id: c.id,
  }));
}

/**
 * Resolve a Riot champion ID to the Data Dragon champion key (e.g. 64 -> "LeeSin", 888 -> "Renata").
 */
export function resolveChampionKey(championId: number): string {
  return resolveChampionKeyFromRegistry(championId);
}
