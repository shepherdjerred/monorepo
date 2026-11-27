import type { AbilityNameIndex } from "#src/tips/grounding.ts";

/**
 * Official ability names are names, not prose. Some carry punctuation or digits
 * ("Flap, Flap, Flap", "Watch Out! Eep!", "90 Caliber Net"), which a sentence
 * counter, a number check and a length limit would all misread. The name list
 * comes from the ability facts (every champion's abilities), never from a hand
 * list.
 */

/** What a name becomes while a text is counted: one plain word. */
export const NAME_PLACEHOLDER = "Ability";

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

const patterns = new WeakMap<AbilityNameIndex, RegExp>();

function patternFor(index: AbilityNameIndex): RegExp {
  const known = patterns.get(index);
  if (known !== undefined) {
    return known;
  }
  const names = [...new Set(index.map((owner) => owner.name))]
    .filter((name) => name.length > 0)
    .toSorted((left, right) => right.length - left.length);
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}'-])(?:${names.map((name) => escapeRegExp(name)).join("|")})(?![\p{L}\p{N}-])`,
    "gu",
  );
  patterns.set(index, pattern);
  return pattern;
}

export type MaskedText = {
  /** The text with every ability name replaced by {@link NAME_PLACEHOLDER}. */
  text: string;
  /** How many names were replaced. */
  names: number;
  /** The characters those names took in the original text. */
  nameCharacters: number;
};

/** The text as prose: each ability name, whatever it contains, is one word. */
export function maskAbilityNames(
  text: string,
  index: AbilityNameIndex,
): MaskedText {
  let names = 0;
  let nameCharacters = 0;
  const masked = text.replaceAll(patternFor(index), (match) => {
    names += 1;
    nameCharacters += match.length;
    return NAME_PLACEHOLDER;
  });
  return { text: masked, names, nameCharacters };
}
