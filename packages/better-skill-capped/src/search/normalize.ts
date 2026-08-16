/**
 * Champion names (Kai'Sa, K'Sante, Cho'Gath, Bel'Veth…) contain punctuation
 * that splits into separate tokens under Orama's default tokenizer. Instead
 * of a custom tokenizer, both the index and the query path store/derive a
 * normalized form: NFKD-fold diacritics, lowercase, strip apostrophes,
 * periods, spaces, ampersands, and hyphens — so "kaisa", "kai'sa", and
 * "kai sa" all reach the same token.
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/['’.\s&-]/g, "");
}

/** Map from normalized champion name to its display form. */
export function buildChampionAliases(
  champions: Iterable<string>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const champion of champions) {
    aliases.set(normalizeName(champion), champion);
  }
  return aliases;
}

/**
 * Normalized variants of words that would tokenize badly (contain an
 * apostrophe or period), e.g. a title "Kai'Sa ADC Guide" yields "kaisa".
 */
export function auxiliaryTerms(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => /['’.]/.test(word))
    .map((word) => normalizeName(word))
    .filter((word) => word.length > 0)
    .join(" ");
}
