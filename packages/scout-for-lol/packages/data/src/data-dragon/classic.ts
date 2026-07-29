import { z } from "zod";
import championData from "./assets/champion.json" with { type: "json" };
import { summoner } from "./summoner.ts";

const ClassicChampionCatalogSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
    }),
  ),
});

const catalogInput: unknown = championData;
const championCatalog = ClassicChampionCatalogSchema.parse(catalogInput);
const championEntries = Object.values(championCatalog.data);

function exactlyOne<T>(values: readonly T[], description: string): T {
  if (values.length !== 1) {
    throw new Error(
      `Expected exactly one ${description}, found ${values.length.toString()}`,
    );
  }
  const value = values[0];
  if (value === undefined) {
    throw new Error(`Missing ${description}`);
  }
  return value;
}

export function resolveClassicChampionKey(championId: number): string {
  const entry = exactlyOne(
    championEntries.filter(
      (candidate) =>
        Number(candidate.key) === championId &&
        candidate.id.startsWith("Jade_"),
    ),
    `Classic champion for id ${championId.toString()}`,
  );
  return entry.id;
}

export function getModernChampionIdForClassic(
  classicChampionId: number,
): number {
  const classicEntry = exactlyOne(
    championEntries.filter(
      (candidate) =>
        Number(candidate.key) === classicChampionId &&
        candidate.id.startsWith("Jade_"),
    ),
    `Classic champion for id ${classicChampionId.toString()}`,
  );
  const modernEntry = exactlyOne(
    championEntries.filter(
      (candidate) =>
        !candidate.id.startsWith("Jade_") &&
        candidate.name === classicEntry.name,
    ),
    `modern champion named ${classicEntry.name}`,
  );
  return z.coerce.number().int().positive().parse(modernEntry.key);
}

const spellEntries = Object.values(summoner.data);

export function getSummonerSpellImageNameById(spellId: number): string {
  const spell = exactlyOne(
    spellEntries.filter((candidate) => Number(candidate.key) === spellId),
    `summoner spell for id ${spellId.toString()}`,
  );
  return spell.image.full;
}

export function getModernSpellIdForClassic(
  classicSpellId: number,
): number | undefined {
  const classicSpell = exactlyOne(
    spellEntries.filter(
      (candidate) =>
        Number(candidate.key) === classicSpellId &&
        candidate.image.full.includes("_Jade."),
    ),
    `Classic summoner spell for id ${classicSpellId.toString()}`,
  );
  const modernImageName = classicSpell.image.full.replace("_Jade.", ".");
  const modernMatches = spellEntries.filter(
    (candidate) => candidate.image.full === modernImageName,
  );
  if (modernMatches.length === 0) {
    return undefined;
  }
  const modernSpell = exactlyOne(
    modernMatches,
    `modern summoner spell named ${classicSpell.name}`,
  );
  return z.coerce.number().int().nonnegative().parse(modernSpell.key);
}

export const CLASSIC_CHAMPION_COUNT = championEntries.filter((entry) =>
  entry.id.startsWith("Jade_"),
).length;

export const CLASSIC_SUMMONER_SPELL_COUNT = spellEntries.filter((entry) =>
  entry.image.full.includes("_Jade."),
).length;
