import { z } from "zod";
import { normalizeChampionName } from "./images.ts";

const ChampionSpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tooltip: z.string(),
});

const ChampionDataSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string(),
      spells: z.array(ChampionSpellSchema), // Q, W, E, R
      passive: z.object({
        name: z.string(),
        description: z.string(),
      }),
    }),
  ),
});

// Cache champion data to avoid repeated reads
const championCache = new Map<
  string,
  {
    spells: { name: string; description: string; tooltip: string }[];
    passive: { name: string; description: string };
  }
>();

// Cache for champion list
let championListCache: { id: string; name: string }[] | null = null;

/**
 * Schema for the champion list data from Data Dragon
 */
const ChampionListSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
});

/**
 * Get a list of all champions (id and display name)
 * Used for autocomplete and validation
 * @returns Array of champions with id and name
 */
export async function getChampionList(): Promise<
  { id: string; name: string }[]
> {
  // Return cached list if available
  if (championListCache !== null) {
    return championListCache;
  }

  try {
    // Read the champion list file (contains all champions in one file)
    const championListPath = `${import.meta.dir}/assets/champion.json`;
    const fileContent = await Bun.file(championListPath).text();
    const data = ChampionListSchema.parse(JSON.parse(fileContent));

    // Convert to array and sort by name
    championListCache = Object.values(data.data)
      .map((c) => ({ id: c.id, name: c.name }))
      .toSorted((a, b) => a.name.localeCompare(b.name));

    return championListCache;
  } catch {
    // Return empty array if file doesn't exist
    return [];
  }
}

/**
 * Get champion ability and passive information from cached local files
 * @param championName - Champion name (e.g., "Aatrox", "LeeSin")
 * @returns Champion spell and passive data, or undefined if not found
 */
export async function getChampionInfo(championName: string): Promise<
  | {
      spells: { name: string; description: string; tooltip: string }[];
      passive: { name: string; description: string };
    }
  | undefined
> {
  const normalized = normalizeChampionName(championName);

  // Check cache first
  if (championCache.has(normalized)) {
    return championCache.get(normalized);
  }

  try {
    const championFilePath = `${import.meta.dir}/assets/champion/${normalized}.json`;
    const fileContent = await Bun.file(championFilePath).text();
    const data = ChampionDataSchema.parse(JSON.parse(fileContent));
    const championData = data.data[normalized];

    if (!championData) {
      return undefined;
    }

    const result = {
      spells: championData.spells.map((s) => ({
        name: s.name,
        description: s.description,
        tooltip: s.tooltip,
      })),
      passive: championData.passive,
    };

    // Cache the result
    championCache.set(normalized, result);

    return result;
  } catch {
    return undefined;
  }
}
