import type { BucksAskAnalyticsDataset } from "#src/betting/analytics/ask-analytics.ts";

export function normalizeBucksAlias(alias: string): string {
  return alias.trim().toLocaleLowerCase();
}

export function bucksAliasOwners(
  dataset: BucksAskAnalyticsDataset,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const [puuid, history] of dataset.aliasesByPuuid) {
    for (const alias of history.aliases) {
      const normalized = normalizeBucksAlias(alias);
      const existing = owners.get(normalized);
      if (existing === undefined) {
        owners.set(normalized, new Set([puuid]));
      } else {
        existing.add(puuid);
      }
    }
  }
  return owners;
}

export function bucksLatestAliasOwners(
  dataset: BucksAskAnalyticsDataset,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const [puuid, history] of dataset.aliasesByPuuid) {
    const normalized = normalizeBucksAlias(history.latestAlias);
    const existing = owners.get(normalized);
    if (existing === undefined) {
      owners.set(normalized, new Set([puuid]));
    } else {
      existing.add(puuid);
    }
  }
  return owners;
}

export function ambiguousLatestBucksAliases(
  dataset: BucksAskAnalyticsDataset,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  return uniqueBucksAliases(
    [...dataset.aliasesByPuuid.values()]
      .filter(
        (history) =>
          (owners.get(normalizeBucksAlias(history.latestAlias))?.size ?? 0) > 1,
      )
      .map((history) => history.latestAlias),
  );
}

export function uniqueBucksAliases(aliases: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const alias of aliases) {
    unique.set(normalizeBucksAlias(alias), alias);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right));
}

export function disambiguatedBucksSubjectLabel(
  alias: string,
  puuid: string,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const aliasOwners = owners.get(normalizeBucksAlias(alias));
  if (aliasOwners === undefined || aliasOwners.size <= 1) return alias;
  const ownerIndex = [...aliasOwners].sort().indexOf(puuid);
  if (ownerIndex === -1) {
    throw new Error("A Bryan Bucks subject is missing from its alias owners");
  }
  return `${alias} [player ${(ownerIndex + 1).toString()}]`;
}
