import {
  type AbilitySlot,
  type ChampionAbilityFacts,
  getAbilityFacts,
} from "#src/data-dragon/ability-facts.ts";
import { getChampionInfo } from "#src/data-dragon/champion.ts";
import type { PatchChangeLine } from "#src/data-dragon/patch-changes-schema.ts";
import type { ChampionId } from "#src/model/core/identifiers.ts";
import { recentChampionChanges } from "#src/tips/patch-context.ts";
import {
  getAllChampions,
  getChampionById,
} from "#src/model/riot/champion-registry.ts";

/**
 * The facts a tip is written from and checked against: the committed ability
 * facts plus Data Dragon's tags and Riot's own ally/enemy tips.
 */
export type ChampionGrounding = {
  championId: ChampionId;
  /** Data Dragon key, also the generated file name (`MonkeyKing`). */
  key: string;
  /** Display name (`Wukong`). */
  name: string;
  facts: ChampionAbilityFacts;
  tags: readonly string[];
  allytips: readonly string[];
  enemytips: readonly string[];
  /** The champion's changes in the recent patches, newest first. */
  recentChanges: readonly PatchChangeLine[];
};

const groundingCache = new Map<ChampionId, ChampionGrounding>();

/**
 * Load one champion's grounding. Both sources are committed snapshots, so a
 * registry-known champion with no facts is a broken contract and throws.
 */
export async function loadChampionGrounding(
  championId: ChampionId,
): Promise<ChampionGrounding> {
  const cached = groundingCache.get(championId);
  if (cached !== undefined) {
    return cached;
  }
  const entry = getChampionById(championId);
  if (entry === undefined) {
    throw new Error(
      `champion ${championId.toString()} is not in the Data Dragon registry`,
    );
  }
  const lookup = await getAbilityFacts(entry.key);
  if (lookup.status !== "found") {
    throw new Error(`no ability facts for champion ${entry.key}`);
  }
  const info = await getChampionInfo(entry.key);
  if (info === undefined) {
    throw new Error(`no Data Dragon champion file for ${entry.key}`);
  }
  const grounding: ChampionGrounding = {
    championId,
    key: entry.key,
    name: entry.name,
    facts: lookup.facts,
    tags: info.tags,
    allytips: info.allytips,
    enemytips: info.enemytips,
    recentChanges: recentChampionChanges(championId),
  };
  groundingCache.set(championId, grounding);
  return grounding;
}

export type AbilityNameOwner = {
  name: string;
  championId: ChampionId;
  slot: AbilitySlot;
};

const ABILITY_SLOTS: readonly AbilitySlot[] = ["passive", "Q", "W", "E", "R"];

export function abilityOwners(
  grounding: Pick<ChampionGrounding, "championId" | "facts">,
): AbilityNameOwner[] {
  return ABILITY_SLOTS.map((slot) => ({
    name: grounding.facts.abilities[slot].name,
    championId: grounding.championId,
    slot,
  }));
}

/**
 * Every ability name of every champion, longest first so a scan matches
 * `Spirit Rush` before any shorter name inside it.
 */
export type AbilityNameIndex = readonly AbilityNameOwner[];

let abilityNameIndexCache: AbilityNameIndex | undefined;

export function buildAbilityNameIndex(
  groundings: readonly Pick<ChampionGrounding, "championId" | "facts">[],
): AbilityNameIndex {
  return groundings
    .flatMap((grounding) => abilityOwners(grounding))
    .toSorted(
      (left, right) =>
        right.name.length - left.name.length ||
        left.name.localeCompare(right.name),
    );
}

export async function loadAbilityNameIndex(): Promise<AbilityNameIndex> {
  if (abilityNameIndexCache !== undefined) {
    return abilityNameIndexCache;
  }
  const groundings = await Promise.all(
    getAllChampions().map((champion) => loadChampionGrounding(champion.id)),
  );
  abilityNameIndexCache = buildAbilityNameIndex(groundings);
  return abilityNameIndexCache;
}
