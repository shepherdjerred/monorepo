import { z } from "zod";
import { normalizeChampionName } from "#src/model/champion-registry.ts";

const ChampionSpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tooltip: z.string(),
  maxrank: z.number().int().positive(),
  cooldown: z.array(z.number()),
  cooldownBurn: z.string(),
  cost: z.array(z.number()),
  costBurn: z.string(),
  costType: z.string(),
  range: z.array(z.number()),
  rangeBurn: z.string(),
});

export type ChampionSpell = z.infer<typeof ChampionSpellSchema>;

export const ChampionTagSchema = z.enum([
  "Assassin",
  "Fighter",
  "Mage",
  "Marksman",
  "Support",
  "Tank",
]);
export type ChampionTag = z.infer<typeof ChampionTagSchema>;

const ChampionDataSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string(),
      tags: z.array(ChampionTagSchema).min(1),
      spells: z.array(ChampionSpellSchema), // Q, W, E, R
      passive: z.object({
        name: z.string(),
        description: z.string(),
      }),
    }),
  ),
});

export type ChampionInfo = {
  spells: ChampionSpell[];
  passive: { name: string; description: string };
  tags: ChampionTag[];
};

// Cache champion data to avoid repeated reads
const championCache = new Map<string, ChampionInfo>();

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

  const championListPath = `${import.meta.dir}/assets/champion.json`;
  const fileContent = await Bun.file(championListPath).text();
  const data = ChampionListSchema.parse(JSON.parse(fileContent));

  championListCache = Object.values(data.data)
    .map((c) => ({ id: c.id, name: c.name }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return championListCache;
}

/**
 * Get champion ability and passive information from cached local files
 * @param championName - Champion name (e.g., "Aatrox", "LeeSin")
 * @returns Champion spell and passive data, or undefined if not found
 */
export async function getChampionInfo(
  championName: string,
): Promise<ChampionInfo | undefined> {
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

    const result: ChampionInfo = {
      spells: championData.spells,
      passive: championData.passive,
      tags: championData.tags,
    };

    // Cache the result
    championCache.set(normalized, result);

    return result;
  } catch {
    return undefined;
  }
}

/** Read Riot's coarse champion classes from the bundled Data Dragon snapshot. */
export async function getChampionTags(
  championName: string,
): Promise<ChampionTag[] | undefined> {
  const champion = await getChampionInfo(championName);
  return champion?.tags;
}
