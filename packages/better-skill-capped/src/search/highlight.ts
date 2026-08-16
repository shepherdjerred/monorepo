import { normalizeName } from "./normalize.ts";

/**
 * Terms to feed react-highlight-words. Orama v3 does not return match
 * positions, so highlighting re-derives from the query: every token of at
 * least two characters, plus any champion display name whose normalized form
 * matches a normalized query token ("kaisa" highlights "Kai'Sa").
 *
 * Accepted limitation: tolerance-corrected typos don't highlight.
 */
export function getHighlightTerms(
  query: string,
  championAliases: ReadonlyMap<string, string>,
): string[] {
  const tokens = query
    .split(/[\s|]+/)
    .map((token) => token.replaceAll(/^[='!^$]+|[='!^$]+$/g, ""))
    .filter((token) => token.length >= 2);

  const championMatches = tokens.flatMap((token) => {
    const display = championAliases.get(normalizeName(token));
    return display === undefined ? [] : [display];
  });

  return [...new Set([...tokens, ...championMatches])];
}
