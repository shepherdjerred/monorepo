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
  const classicEntry = championEntries.find(
    (candidate) =>
      Number(candidate.key) === championId && candidate.id.startsWith("Jade_"),
  );
  if (classicEntry !== undefined) {
    return classicEntry.id;
  }

  const modernEntry = exactlyOne(
    championEntries.filter(
      (candidate) =>
        Number(candidate.key) === championId &&
        !candidate.id.startsWith("Jade_"),
    ),
    `modern champion for id ${championId.toString()}`,
  );
  const entry = exactlyOne(
    championEntries.filter(
      (candidate) =>
        candidate.id.startsWith("Jade_") && candidate.name === modernEntry.name,
    ),
    `Classic champion named ${modernEntry.name}`,
  );
  return entry.id;
}

/** Normalize a Riot Match/Spectator champion ID to the Classic asset ID. */
export function getClassicChampionId(championId: number): number {
  const classicEntry = championEntries.find(
    (candidate) =>
      Number(candidate.key) === championId && candidate.id.startsWith("Jade_"),
  );
  if (classicEntry !== undefined) {
    return championId;
  }
  const modernEntry = exactlyOne(
    championEntries.filter(
      (candidate) =>
        Number(candidate.key) === championId &&
        !candidate.id.startsWith("Jade_"),
    ),
    `modern champion for id ${championId.toString()}`,
  );
  const classicEntryForModern = exactlyOne(
    championEntries.filter(
      (candidate) =>
        candidate.id.startsWith("Jade_") && candidate.name === modernEntry.name,
    ),
    `Classic champion named ${modernEntry.name}`,
  );
  return Number(classicEntryForModern.key);
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
  const classicSpells = spellEntries.filter(
    (candidate) =>
      Number(candidate.key) === classicSpellId &&
      candidate.image.full.includes("_Jade."),
  );
  if (classicSpells.length === 0) {
    const modernSpell = exactlyOne(
      spellEntries.filter(
        (candidate) =>
          Number(candidate.key) === classicSpellId &&
          !candidate.image.full.includes("_Jade."),
      ),
      `modern summoner spell for id ${classicSpellId.toString()}`,
    );
    return Number(modernSpell.key);
  }
  const classicSpell = exactlyOne(
    classicSpells,
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

/** Normalize a Riot Match/Spectator spell ID to the Classic asset ID. */
export function getClassicSpellId(spellId: number): number {
  const classicSpell = spellEntries.find(
    (candidate) =>
      Number(candidate.key) === spellId &&
      candidate.image.full.includes("_Jade."),
  );
  if (classicSpell !== undefined) {
    return spellId;
  }
  const modernSpell = exactlyOne(
    spellEntries.filter(
      (candidate) =>
        Number(candidate.key) === spellId &&
        !candidate.image.full.includes("_Jade."),
    ),
    `modern summoner spell for id ${spellId.toString()}`,
  );
  const classicImage = modernSpell.image.full.replace(".", "_Jade.");
  const classicSpellsForModern = spellEntries.filter(
    (candidate) => candidate.image.full === classicImage,
  );
  if (classicSpellsForModern.length === 0) {
    // Some mode-specific modern spells, such as ARAM Mark, have no Jade
    // asset. Keep the Riot ID so the renderer can use the canonical image.
    return spellId;
  }
  const classicSpellForModern = exactlyOne(
    classicSpellsForModern,
    `Classic summoner spell named ${modernSpell.name}`,
  );
  return Number(classicSpellForModern.key);
}

export const CLASSIC_CHAMPION_COUNT = championEntries.filter((entry) =>
  entry.id.startsWith("Jade_"),
).length;

export const CLASSIC_SUMMONER_SPELL_COUNT = spellEntries.filter((entry) =>
  entry.image.full.includes("_Jade."),
).length;
