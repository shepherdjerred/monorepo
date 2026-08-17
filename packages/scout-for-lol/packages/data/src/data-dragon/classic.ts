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
      modernKey: z.string().optional(),
    }),
  ),
});

const catalogInput: unknown = championData;
const championCatalog = ClassicChampionCatalogSchema.parse(catalogInput);
const championEntries = Object.values(championCatalog.data);
const normalEntries = championEntries.filter(
  (candidate) => !candidate.id.startsWith("Jade_"),
);
const classicEntries = championEntries.filter((candidate) =>
  candidate.id.startsWith("Jade_"),
);

const normalById = new Map(
  normalEntries.map((entry) => [Number(entry.key), entry]),
);
const classicById = new Map(
  classicEntries.map((entry) => [Number(entry.key), entry]),
);
const classicByModernId = new Map(
  classicEntries
    .filter((entry) => entry.modernKey !== undefined)
    .map((entry) => [Number(entry.modernKey), entry]),
);

export function validateClassicChampionCatalog(): void {
  const errors: string[] = [];
  const checkUniqueIds = (entries: typeof championEntries, label: string) => {
    const ids = new Set<number>();
    for (const entry of entries) {
      const id = Number(entry.key);
      if (ids.has(id)) {
        errors.push(`duplicate ${label} champion id ${String(id)}`);
      }
      ids.add(id);
    }
  };
  checkUniqueIds(normalEntries, "normal");
  checkUniqueIds(classicEntries, "Classic");
  const modernKeys = new Set<number>();

  for (const entry of classicEntries) {
    if (entry.modernKey === undefined) {
      errors.push(`${entry.id} is missing modernKey`);
      continue;
    }
    const modern = normalById.get(Number(entry.modernKey));
    if (modern === undefined) {
      errors.push(
        `${entry.id} modernKey ${entry.modernKey} does not identify a normal champion`,
      );
    } else if (Number(entry.key) !== 60_000 + Number(entry.modernKey)) {
      errors.push(
        `${entry.id} key ${entry.key} is not 60000 plus modernKey ${entry.modernKey}`,
      );
    }
    if (modernKeys.has(Number(entry.modernKey))) {
      errors.push(`duplicate Classic modernKey ${entry.modernKey}`);
    }
    modernKeys.add(Number(entry.modernKey));
  }
  for (const entry of normalEntries) {
    if (normalById.get(Number(entry.key)) !== entry) {
      errors.push(`${entry.id} is not independently resolvable by id`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid champion catalog: ${errors.join("; ")}`);
  }
}

validateClassicChampionCatalog();

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
  const classicEntry = classicById.get(championId);
  if (classicEntry !== undefined) {
    return classicEntry.id;
  }
  const mapped = classicByModernId.get(championId);
  if (mapped !== undefined) {
    return mapped.id;
  }
  throw new Error(
    `No Classic champion mapping for modern id ${championId.toString()}`,
  );
}

/** Normalize a Riot Match/Spectator champion ID to the Classic asset ID. */
export function getClassicChampionId(championId: number): number {
  const classicEntry = classicById.get(championId);
  if (classicEntry !== undefined) {
    return championId;
  }
  const modernEntry = normalById.get(championId);
  if (modernEntry === undefined) {
    throw new Error(`Unknown champion id ${championId.toString()}`);
  }
  const mapped = classicByModernId.get(championId);
  if (mapped === undefined) {
    throw new Error(
      `No Classic champion mapping for modern id ${championId.toString()}`,
    );
  }
  return Number(mapped.key);
}

export function getModernChampionIdForClassic(
  classicChampionId: number,
): number {
  const classicEntry = classicById.get(classicChampionId);
  if (classicEntry === undefined) {
    throw new Error(
      `Unknown Classic champion id ${classicChampionId.toString()}`,
    );
  }
  if (classicEntry.modernKey === undefined) {
    throw new Error(`Classic champion ${classicEntry.id} is missing modernKey`);
  }
  return z.coerce.number().int().positive().parse(classicEntry.modernKey);
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
