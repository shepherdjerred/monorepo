import {
  findSummonerSpells,
  getItemInfo,
  getRuneInfo,
  getRuneTreeName,
} from "@scout-for-lol/data";
import { getItemImageUrl } from "@scout-for-lol/data/data-dragon/images.ts";

/**
 * Names for the ids the meta API returns, from the committed Data Dragon
 * assets. An id Data Dragon does not know fails the build: a refresh PR that
 * brings one in is blocked until Data Dragon catches up, instead of the site
 * showing a bare number.
 */

export function itemView(itemId: number): { name: string; icon: string } {
  const info = getItemInfo(itemId);
  if (info === undefined)
    throw new Error(`Unknown item id ${itemId.toString()}`);
  return { name: info.name, icon: getItemImageUrl(itemId) };
}

export function runeName(runeId: number): string {
  const info = getRuneInfo(runeId);
  if (info === undefined)
    throw new Error(`Unknown rune id ${runeId.toString()}`);
  return info.name;
}

export function runeTreeName(styleId: number): string {
  const name = getRuneTreeName(styleId);
  if (name === undefined) {
    throw new Error(`Unknown rune tree id ${styleId.toString()}`);
  }
  return name;
}

export function spellName(spellId: number): string {
  const spell = findSummonerSpells(spellId.toString()).find(
    (candidate) => candidate.key === spellId.toString(),
  );
  if (spell === undefined) {
    throw new Error(`Unknown summoner spell id ${spellId.toString()}`);
  }
  return spell.name;
}
