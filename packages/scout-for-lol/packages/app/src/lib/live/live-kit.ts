import { getRuneInfo, summoner } from "@scout-for-lol/data";
import type { AssetRef } from "@scout-for-lol/design-system/domain/rows/asset-icon";

/** A summoner spell or rune as an icon to draw and the name to read it by. */
export type KitItem = { asset: AssetRef; name: string };

const spellByNumericId = new Map(
  Object.values(summoner.data).map((spell) => [Number(spell.key), spell]),
);

/** The summoner spell Riot's spectator payload names by number. */
export function spellItem(spellId: number): KitItem {
  const spell = spellByNumericId.get(spellId);
  if (spell === undefined) {
    throw new Error(`Unknown summoner spell id ${spellId.toString()}`);
  }
  return { asset: { kind: "spell", key: spell.id }, name: spell.name };
}

/** The keystone rune a lobby shows, drawn from the icon its page names. */
export function runeItem(runeId: number): KitItem {
  const rune = getRuneInfo(runeId);
  const key = rune?.icon
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "");
  if (rune === undefined || key === undefined) {
    throw new Error(`Unknown rune id ${runeId.toString()}`);
  }
  return { asset: { kind: "rune", key }, name: rune.name };
}
