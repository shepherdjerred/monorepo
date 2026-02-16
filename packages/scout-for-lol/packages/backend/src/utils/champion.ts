import {
  Champions,
  getChampionName,
} from "twisted/dist/constants/champions.js";
import { z } from "zod";

/**
 * Champion ID to name mapping (provided by twisted package)
 * Example: { 1: "ANNIE", 2: "OLAF", ... }
 */
const CHAMPION_ID_TO_NAME: Record<number, string> = Champions;

/**
 * Champion name to ID mapping (reverse of Champions)
 * Built once on module load for efficient lookups
 * Normalized to lowercase for case-insensitive matching
 */
const CHAMPION_NAME_TO_ID: Record<string, number> = Object.entries(
  CHAMPION_ID_TO_NAME,
).reduce<Record<string, number>>((acc, [id, name]) => {
  // Champions object has both id->name and name->id mappings
  // Filter to only string values to avoid duplicates and type errors
  const nameValidation = z.string().safeParse(name);
  if (nameValidation.success) {
    const normalizedName = nameValidation.data.toLowerCase();
    acc[normalizedName] = Number.parseInt(id, 10);
  }
  return acc;
}, {});

/**
 * Get champion ID from champion name
 * Case-insensitive matching
 *
 * @param name Champion name (e.g., "yasuo", "Yasuo", "YASUO")
 * @returns Champion ID or undefined if not found
 *
 * @example
 * getChampionId("yasuo") // 157
 * getChampionId("TWISTED_FATE") // 4
 */
export function getChampionId(name: string): number | undefined {
  const normalized = name.toLowerCase().replace(/['\s-]/g, "_");
  return CHAMPION_NAME_TO_ID[normalized];
}

/**
 * Get display name for a champion (with proper formatting)
 * Converts TWISTED_FATE to "Twisted Fate"
 *
 * @param championId Champion ID
 * @returns Formatted champion name or "Unknown Champion" if not found
 *
 * @example
 * getChampionDisplayName(4) // "Twisted Fate"
 * getChampionDisplayName(157) // "Yasuo"
 */
export function getChampionDisplayName(championId: number): string {
  try {
    const name = getChampionName(championId);
    if (!name || name === "") {
      return `Champion ${championId.toString()}`;
    }

    // Convert TWISTED_FATE to "Twisted Fate"
    return name
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return `Champion ${championId.toString()}`;
  }
}

/**
 * Search for champions by name prefix
 * Returns array of {name, id} sorted by relevance
 * Used for autocomplete in Discord commands
 *
 * @param query Search query (partial champion name)
 * @param limit Maximum number of results (default: 25, Discord limit)
 * @returns Array of matching champions with display names and IDs
 *
 * @example
 * searchChampions("yas") // [{name: "Yasuo", id: 157}]
 * searchChampions("twisted") // [{name: "Twisted Fate", id: 4}]
 */
export function searchChampions(
  query: string,
  limit = 25,
): { name: string; id: number }[] {
  const normalizedQuery = query.toLowerCase().replace(/['\s-]/g, "_");

  // Get all champions
  const allChampions = Object.entries(CHAMPION_NAME_TO_ID)
    .filter(([name]) => name !== "empty_champion") // Skip empty champion slot
    .map(([name, id]) => ({
      name: getChampionDisplayName(id),
      id,
      searchName: name,
    }));

  // Filter by query
  const matches = allChampions.filter((champion) => {
    return (
      champion.searchName.includes(normalizedQuery) ||
      champion.name.toLowerCase().includes(query.toLowerCase())
    );
  });

  // Sort by relevance: exact matches first, then starts-with, then contains
  matches.sort((a, b) => {
    const aExact = a.searchName === normalizedQuery ? 1 : 0;
    const bExact = b.searchName === normalizedQuery ? 1 : 0;
    if (aExact !== bExact) {
      return bExact - aExact;
    }

    const aStarts = a.searchName.startsWith(normalizedQuery) ? 1 : 0;
    const bStarts = b.searchName.startsWith(normalizedQuery) ? 1 : 0;
    if (aStarts !== bStarts) {
      return bStarts - aStarts;
    }

    // Alphabetical as tie-breaker
    return a.name.localeCompare(b.name);
  });

  return matches.slice(0, limit);
}

/**
 * Get all champions as an array
 * @returns Array of all champions with their IDs and display names
 */
export function getAllChampions(): { name: string; id: number }[] {
  return Object.entries(CHAMPION_NAME_TO_ID)
    .filter(([name]) => name !== "empty_champion")
    .map(([, id]) => ({
      name: getChampionDisplayName(id),
      id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
