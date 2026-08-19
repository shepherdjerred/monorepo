import { ParlaySubjectsSchema } from "#src/betting/parlay-criteria.ts";

export type ParlayAliasMarket = {
  matchId: string;
  definition: { subjects: string };
};

export type ParlayMarketSelection =
  | { kind: "selected"; market: ParlayAliasMarket }
  | { kind: "ambiguous"; matchIds: string[] }
  | { kind: "not_found"; availableAliases: string[] };

/** Resolve the free-text command alias without ever picking an arbitrary
 * market. Discord buttons already carry the exact match id; the command must
 * refuse when stale or overlapping markets make an alias ambiguous. */
export function selectParlayMarketForAlias(
  markets: readonly ParlayAliasMarket[],
  requestedAlias: string,
): ParlayMarketSelection {
  const normalizedAlias = requestedAlias.toLowerCase();
  const parsed = markets.map((market) => ({
    market,
    subjects: ParlaySubjectsSchema.parse(
      JSON.parse(market.definition.subjects),
    ),
  }));
  const matching = parsed.filter(({ subjects }) =>
    subjects.some((subject) => subject.alias.toLowerCase() === normalizedAlias),
  );
  if (matching.length === 1) {
    const selected = matching[0];
    if (selected === undefined) {
      throw new Error("Single parlay match could not be selected");
    }
    return { kind: "selected", market: selected.market };
  }
  if (matching.length > 1) {
    return {
      kind: "ambiguous",
      matchIds: matching.map(({ market }) => market.matchId).sort(),
    };
  }
  return {
    kind: "not_found",
    availableAliases: [
      ...new Set(
        parsed.flatMap(({ subjects }) =>
          subjects.map((subject) => subject.alias),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  };
}
