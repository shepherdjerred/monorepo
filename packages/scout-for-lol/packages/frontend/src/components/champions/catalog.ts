import {
  findSummonerSpells,
  getItemInfo,
  getRuneInfo,
  getRuneTreeName,
} from "@scout-for-lol/data";
import { normalizeBrowserChampionKey } from "@scout-for-lol/data/browser-assets";

/**
 * Names and icons for the ids the meta API returns, from the committed Data
 * Dragon assets. An id Data Dragon does not know fails the build: a refresh PR
 * that brings one in is blocked until Data Dragon catches up, instead of the
 * site showing a bare number.
 */

/** An icon the setup rows draw: an item, a rune, a summoner spell or an ability. */
export type CatalogAsset = {
  kind: "item" | "rune" | "spell" | "ability" | "lane";
  key: string | number;
};

export function itemName(itemId: number): string {
  const info = getItemInfo(itemId);
  if (info === undefined)
    throw new Error(`Unknown item id ${itemId.toString()}`);
  return info.name;
}

export function itemAsset(itemId: number): CatalogAsset {
  itemName(itemId);
  return { kind: "item", key: itemId };
}

export function runeName(runeId: number): string {
  const info = getRuneInfo(runeId);
  if (info === undefined)
    throw new Error(`Unknown rune id ${runeId.toString()}`);
  return info.name;
}

export function runeAsset(runeId: number): CatalogAsset {
  const info = getRuneInfo(runeId);
  if (info === undefined) {
    throw new Error(`Unknown rune id ${runeId.toString()}`);
  }
  return { kind: "rune", key: info.icon };
}

export function runeTreeName(styleId: number): string {
  const name = getRuneTreeName(styleId);
  if (name === undefined) {
    throw new Error(`Unknown rune tree id ${styleId.toString()}`);
  }
  return name;
}

function summonerSpell(spellId: number) {
  const spell = findSummonerSpells(spellId.toString()).find(
    (candidate) => candidate.key === spellId.toString(),
  );
  if (spell === undefined) {
    throw new Error(`Unknown summoner spell id ${spellId.toString()}`);
  }
  return spell;
}

export function spellName(spellId: number): string {
  return summonerSpell(spellId).name;
}

export function spellAsset(spellId: number): CatalogAsset {
  return { kind: "spell", key: summonerSpell(spellId).id };
}

const ABILITY_SLOTS = ["Q", "W", "E", "R"] as const;
export type AbilitySlot = (typeof ABILITY_SLOTS)[number];

export function abilitySlot(letter: string): AbilitySlot {
  const slot = ABILITY_SLOTS.find((candidate) => candidate === letter);
  if (slot === undefined) {
    throw new Error(`Unknown ability slot ${letter}`);
  }
  return slot;
}

/** The champion's ability icon, for example `Ahri-Q`. */
export function abilityAsset(
  championId: number,
  slot: AbilitySlot,
): CatalogAsset {
  return {
    kind: "ability",
    key: `${normalizeBrowserChampionKey(championId)}-${slot}`,
  };
}
