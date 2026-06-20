/**
 * Combined partial-name summoner search: our own index first, then OP.GG.
 * Suggestions are unverified — the UI verifies the picked Riot ID via Riot's
 * official API (which also keeps the index fresh) before it's stored.
 */

import { searchIndex } from "#src/lib/riot/summoner-index.ts";
import { opggSearch } from "#src/lib/riot/opgg-search.ts";

export type SummonerSearchItem = {
  gameName: string;
  tagLine: string;
  region: string;
  tier: string | null;
  source: "index" | "opgg";
};

const MAX_RESULTS = 15;

export async function searchSummoners(
  query: string,
  region: string | undefined,
): Promise<SummonerSearchItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const [indexResults, opggResults] = await Promise.all([
    searchIndex(trimmed, 10),
    region === undefined ? Promise.resolve([]) : opggSearch(trimmed, region),
  ]);

  const seen = new Set<string>();
  const merged: SummonerSearchItem[] = [];
  const add = (
    item: Omit<SummonerSearchItem, "source">,
    source: SummonerSearchItem["source"],
  ) => {
    const key = `${item.gameName.toLowerCase()}#${item.tagLine.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...item, source });
  };

  // Our own index ranks first (already Riot-verified at some point).
  for (const row of indexResults) {
    add({ ...row, tier: null }, "index");
  }
  for (const row of opggResults) {
    add(row, "opgg");
  }
  return merged.slice(0, MAX_RESULTS);
}
