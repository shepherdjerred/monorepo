import { z } from "zod";
import { ChampionAbilityFactsSchema } from "#src/data-dragon/ability-facts.ts";
import { items } from "#src/data-dragon/item.ts";
import { runes } from "#src/data-dragon/runes.ts";
import { summoner } from "#src/data-dragon/summoner.ts";
import versionData from "#src/data-dragon/assets/version.json" with { type: "json" };
import type { GameFactSources } from "#src/game-facts/build.ts";
import { GlossaryFileSchema } from "#src/tips/schema.ts";

/** The slice of `assets/champion/<Key>.json` the facts need. */
const ChampionFileSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      title: z.string(),
      blurb: z.string(),
      tags: z.array(z.string()).min(1),
      partype: z.string(),
      stats: z.object({
        hp: z.number(),
        movespeed: z.number(),
        attackrange: z.number(),
      }),
      passive: z.object({ name: z.string(), description: z.string() }),
      spells: z.array(z.object({ name: z.string(), description: z.string() })),
    }),
  ),
});

const assetsRoot = `${import.meta.dir}/../data-dragon/assets`;
const GLOSSARY_PATH = `${import.meta.dir}/../tips/generated/glossary.json`;

/** The tips glossary's keywords; none before a glossary exists. */
async function loadKeywords(): Promise<GameFactSources["keywords"]> {
  const file = Bun.file(GLOSSARY_PATH);
  if (!(await file.exists())) {
    return [];
  }
  return GlossaryFileSchema.parse(await file.json()).entries.map((entry) => ({
    id: entry.id,
    term: entry.term,
    definition: entry.definition,
  }));
}

/**
 * Read the committed Data Dragon snapshot. Champions come from the
 * ability-facts directory: League Classic (`Jade_`) variants share their
 * modern counterpart's kit and carry no ability facts, so they get none here.
 */
export async function loadGameFactSources(): Promise<GameFactSources> {
  const keys: string[] = [];
  for await (const file of new Bun.Glob("*.json").scan({
    cwd: `${assetsRoot}/ability-facts`,
  })) {
    keys.push(file.slice(0, -".json".length));
  }
  const champions = new Map<string, GameFactSources["champions"][number]>();
  const abilityFacts = new Map<
    string,
    GameFactSources["abilityFacts"][number]
  >();
  await Promise.all(
    keys.toSorted().map(async (key) => {
      const file = ChampionFileSchema.parse(
        await Bun.file(`${assetsRoot}/champion/${key}.json`).json(),
      );
      const champion = file.data[key];
      if (champion === undefined) {
        throw new Error(`champion/${key}.json has no entry for ${key}`);
      }
      champions.set(key, champion);
      abilityFacts.set(
        key,
        ChampionAbilityFactsSchema.parse(
          await Bun.file(`${assetsRoot}/ability-facts/${key}.json`).json(),
        ),
      );
    }),
  );
  return {
    patch: z.object({ version: z.string().min(1) }).parse(versionData).version,
    keywords: await loadKeywords(),
    champions: [...champions.values()].toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    abilityFacts: [...abilityFacts.values()].toSorted((left, right) =>
      left.championKey.localeCompare(right.championKey),
    ),
    items: items.data,
    summonerSpells: Object.values(summoner.data),
    runeTrees: runes,
  };
}
