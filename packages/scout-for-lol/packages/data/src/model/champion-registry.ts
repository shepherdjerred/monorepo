import championList from "#src/data-dragon/assets/champion.json" with { type: "json" };
import { type ChampionId, ChampionIdSchema } from "#src/model/identifiers.ts";

export type ChampionEntry = {
  id: ChampionId;
  /** Data Dragon / asset filename key (e.g. "Aatrox", "LeeSin", "MonkeyKing") */
  key: string;
  /** Riot canonical punctuated display name (e.g. "Aatrox", "Lee Sin", "Wukong", "Vel'Koz") */
  name: string;
};

// Numeric champion id -> ChampionEntry
const championById = new Map<number, ChampionEntry>();
// Canonical key (lowercased) -> ChampionEntry
const championByKey = new Map<string, ChampionEntry>();
// Normalized search name -> ChampionEntry
const championByName = new Map<string, ChampionEntry>();

function normalizeSearchTerm(term: string): string {
  return term.toLowerCase().replaceAll(/['\s-]/g, "_");
}

// Build synchronous lookup tables once at module initialization.
// Standard champions are indexed first and cannot be overwritten by League Classic (Jade_) counterparts.
const entries = Object.values(championList.data);
// Sort so standard champions (non-Jade) are processed last or take precedence
const standardEntries = entries.filter((e) => !e.id.startsWith("Jade_"));
const classicEntries = entries.filter((e) => e.id.startsWith("Jade_"));

for (const entry of [...classicEntries, ...standardEntries]) {
  const numericId = Number(entry.key);
  if (!Number.isFinite(numericId)) {
    continue;
  }
  const id = ChampionIdSchema.parse(numericId);
  const record: ChampionEntry = {
    id,
    key: entry.id, // In champion.json, entry.id is the string key ("LeeSin", "MonkeyKing")
    name: entry.name, // entry.name is the display name ("Lee Sin", "Wukong")
  };

  championById.set(id, record);
  championByKey.set(record.key.toLowerCase(), record);

  championByName.set(normalizeSearchTerm(record.name), record);
  championByName.set(normalizeSearchTerm(record.key), record);
}

// Common aliases and match-data casing/naming quirks
const CHAMPION_ALIASES: Record<string, string> = {
  "nunu & willump": "Nunu",
  nunu_willump: "Nunu",
  wukong: "MonkeyKing",
  "renata glasc": "Renata",
  renata_glasc: "Renata",
};

/**
 * Get champion entry by numeric champion ID.
 */
export function getChampionById(
  championId: ChampionId | number,
): ChampionEntry | undefined {
  return championById.get(championId);
}

/**
 * Get champion entry by Data Dragon key (e.g. "LeeSin", "MonkeyKing").
 */
export function getChampionByKey(key: string): ChampionEntry | undefined {
  return championByKey.get(key.toLowerCase());
}

/**
 * Get numeric champion ID from any case or alias string.
 * @example
 * getChampionIdByName("yasuo") // 157
 * getChampionIdByName("Twisted Fate") // 4
 * getChampionIdByName("Wukong") // 62
 */
export function getChampionIdByName(name: string): ChampionId | undefined {
  const normalized = normalizeSearchTerm(name);
  const aliasTarget =
    CHAMPION_ALIASES[normalized] ?? CHAMPION_ALIASES[name.toLowerCase()];
  if (aliasTarget) {
    const aliased = championByKey.get(aliasTarget.toLowerCase());
    if (aliased) return aliased.id;
  }
  return championByName.get(normalized)?.id;
}

/**
 * Get the human display name for a champion by ID (e.g. 4 -> "Twisted Fate", 62 -> "Wukong").
 * Falls back to "Champion <id>" if unknown.
 */
export function getChampionDisplayName(
  championId: ChampionId | number,
): string {
  const entry = championById.get(championId);
  return entry ? entry.name : `Champion ${championId.toString()}`;
}

/**
 * Resolve a numeric champion ID to its Data Dragon filename key (e.g. 64 -> "LeeSin", 62 -> "MonkeyKing").
 */
export function resolveChampionKey(championId: ChampionId | number): string {
  const entry = championById.get(championId);
  return entry ? entry.key : `Champion${championId.toString()}`;
}

/**
 * Normalize any-cased champion name or alias to canonical Data Dragon key.
 */
export function normalizeChampionName(championName: string): string {
  const decoded = championName.includes("%")
    ? decodeURIComponent(championName)
    : championName;
  const lower = decoded.toLowerCase();

  const direct = championByKey.get(lower);
  if (direct) return direct.key;

  const alias =
    CHAMPION_ALIASES[lower] ?? CHAMPION_ALIASES[normalizeSearchTerm(decoded)];
  if (alias) {
    const aliased = championByKey.get(alias.toLowerCase());
    if (aliased) return aliased.key;
  }

  const byName = championByName.get(normalizeSearchTerm(decoded));
  if (byName) return byName.key;

  return decoded;
}

/**
 * Search champions by query for Discord autocomplete / interactive commands.
 */
export function searchChampions(
  query: string,
  limit = 25,
): { name: string; id: ChampionId }[] {
  const normalizedQuery = normalizeSearchTerm(query);
  const lowerQuery = query.toLowerCase();

  const all = [...championById.values()].filter(
    (c) => !c.key.startsWith("Jade_"),
  );

  const matches = all.filter((champion) => {
    const searchName = normalizeSearchTerm(champion.name);
    const searchKey = normalizeSearchTerm(champion.key);
    return (
      searchName.includes(normalizedQuery) ||
      searchKey.includes(normalizedQuery) ||
      champion.name.toLowerCase().includes(lowerQuery)
    );
  });

  const sorted = matches.toSorted((a, b) => {
    const aSearch = normalizeSearchTerm(a.name);
    const bSearch = normalizeSearchTerm(b.name);

    const aExact = aSearch === normalizedQuery ? 1 : 0;
    const bExact = bSearch === normalizedQuery ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aStarts = aSearch.startsWith(normalizedQuery) ? 1 : 0;
    const bStarts = bSearch.startsWith(normalizedQuery) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;

    return a.name.localeCompare(b.name);
  });

  return sorted.slice(0, limit).map((c) => ({
    name: c.name,
    id: c.id,
  }));
}

/**
 * Get all champions sorted alphabetically by display name.
 */
export function getAllChampions(): ChampionEntry[] {
  return [...championById.values()]
    .filter((c) => !c.key.startsWith("Jade_"))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
