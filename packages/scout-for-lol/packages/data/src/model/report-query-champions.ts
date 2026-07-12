import { z } from "zod";
import championData from "#src/data-dragon/assets/champion.json" with { type: "json" };

const ChampionCatalogSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string().min(1),
      key: z.coerce.number().int().positive(),
      name: z.string().min(1),
    }),
  ),
});

export type ReportChampion = {
  id: number;
  name: string;
};

const champions: ReportChampion[] = Object.values(
  ChampionCatalogSchema.parse(championData).data,
)
  .map((champion) => ({ id: champion.key, name: champion.name }))
  .toSorted((left, right) => left.name.localeCompare(right.name));

const championByName = new Map(
  champions.map((champion) => [normalizeName(champion.name), champion]),
);
const championById = new Map(
  champions.map((champion) => [champion.id, champion]),
);

export function reportChampions(): ReportChampion[] {
  return champions;
}

export function resolveReportChampion(
  name: string,
): ReportChampion | undefined {
  return championByName.get(normalizeName(name));
}

export function requireReportChampionName(championId: number): string {
  const champion = championById.get(championId);
  if (champion === undefined) {
    throw new Error(`Unknown champion id ${championId.toString()}.`);
  }
  return champion.name;
}

export function requireReportChampion(name: string): ReportChampion {
  const champion = resolveReportChampion(name);
  if (champion !== undefined) {
    return champion;
  }

  const suggestion = closestChampionName(name);
  throw new Error(
    suggestion === undefined
      ? `Unknown champion "${name}".`
      : `Unknown champion "${name}". Did you mean "${suggestion}"?`,
  );
}

export function closestChampionName(name: string): string | undefined {
  const normalized = normalizeName(name);
  const ranked = champions
    .map((champion) => ({
      name: champion.name,
      distance: editDistance(normalized, normalizeName(champion.name)),
    }))
    .toSorted((left, right) => left.distance - right.distance);
  const closest = ranked[0];
  if (closest === undefined) {
    return undefined;
  }
  const threshold = Math.max(2, Math.floor(normalized.length / 3));
  return closest.distance <= threshold ? closest.name : undefined;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}
