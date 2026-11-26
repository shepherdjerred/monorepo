/**
 * The game's half of a tooltip, as the per-entity fact JSON carries it.
 *
 * These mirror `GameFact` in `@scout-for-lol/data/game-facts/schema.ts`; the
 * shapes are structurally identical, so `loadGameFact` from that package is
 * assignable to `GameFactLoader` without adapting it.
 */

export type GameFactKind =
  "champion" | "ability" | "item" | "rune" | "summoner-spell" | "keyword";

/** A labelled value, already formatted for display ("Cost", "2700 gold"). */
export type GameFactEntry = { label: string; value: string };

/** A part that has a tooltip of its own: an ability, a component item. */
export type GameFactPart = {
  kind: GameFactKind;
  key: string;
  name: string;
  /** Path relative to the game asset root, for example `img/item/3802.png`. */
  icon: string | null;
};

type FactBase = {
  /** Data Dragon patch the facts were generated from. */
  patch: string;
  key: string;
  name: string;
  description: string;
  facts: GameFactEntry[];
  parts: GameFactPart[];
};

export type ChampionFact = FactBase & {
  kind: "champion";
  icon: string;
  art: string;
  title: string;
  roles: string[];
  keyFact: GameFactEntry;
};

export type AbilityFact = FactBase & {
  kind: "ability";
  icon: string;
  slot: "passive" | "Q" | "W" | "E" | "R";
  championKey: string;
  championName: string;
  maxRank: number;
  cooldownByRank: number[];
  costByRank: number[];
  costType: string;
  rangeByRank: number[];
  keyFact: GameFactEntry;
};

export type ItemFact = FactBase & {
  kind: "item";
  icon: string;
  goldTotal: number;
  goldCombine: number;
  keyFact: GameFactEntry;
};

export type RuneFact = FactBase & {
  kind: "rune";
  icon: string;
  tree: string;
  keyFact: GameFactEntry;
};

export type SummonerSpellFact = FactBase & {
  kind: "summoner-spell";
  icon: string;
  cooldownSeconds: number;
  keyFact: GameFactEntry;
};

export type KeywordFact = FactBase & {
  kind: "keyword";
  icon: string | null;
  keyFact: GameFactEntry | null;
};

export type GameFact =
  | ChampionFact
  | AbilityFact
  | ItemFact
  | RuneFact
  | SummonerSpellFact
  | KeywordFact;

export type GameFactLoader = (
  kind: GameFactKind,
  key: string,
  options: { signal: AbortSignal },
) => Promise<GameFact>;
