/**
 * Text helpers for the game-fact builders: Data Dragon descriptions carry
 * game markup (`<magicDamage>`, `<br>`, `<passive>`) and run long; tooltips
 * show plain text trimmed to a sentence or two.
 */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** Sentence boundary: terminal punctuation, optional closer, a capital next. */
const SENTENCE_BOUNDARY =
  /(?<!\b(?:e\.g|i\.e|vs))[.!?]["')\]]*\s+(?=[A-Z"'([])/g;

/** Leave a second sentence out when the pair would exceed this many characters. */
const MAX_DESCRIPTION_CHARACTERS = 260;

/** Marker the ability-facts generator leaves for numbers it could not resolve. */
export function hasUnresolvedToken(text: string): boolean {
  return text.includes("{{");
}

/**
 * Strip game markup to plain text. Line breaks and list items become spaces;
 * `<flavorText>` is lore, not a fact, and is dropped with its content.
 */
export function stripMarkup(markup: string): string {
  const withoutFlavor = markup.replaceAll(
    /<flavorText>[\s\S]*?<\/flavorText>/g,
    " ",
  );
  const withBreaks = withoutFlavor
    .replaceAll(/<br\s*\/?>/gi, " ")
    .replaceAll(/<\/?li>/gi, " ");
  const withoutTags = withBreaks.replaceAll(/<[^>]*>/g, "");
  const decoded = withoutTags.replaceAll(
    /&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );
  return decoded
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s+([.,;:!?])/g, "$1")
    .trim();
}

export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_BOUNDARY)) {
    const end = match.index + match[0].trimEnd().length;
    sentences.push(text.slice(start, end).trim());
    start = match.index + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest.length > 0) sentences.push(rest);
  return sentences;
}

function isTruncated(sentence: string): boolean {
  return sentence.endsWith("...") || sentence.endsWith("…");
}

/**
 * The first sentence, plus the second when the pair stays short. A trailing
 * sentence cut off by Data Dragon (`...`) is dropped when something precedes
 * it.
 */
export function trimDescription(
  text: string,
  maxSentences = 2,
  maxCharacters = MAX_DESCRIPTION_CHARACTERS,
): string {
  const all = splitSentences(text);
  const complete =
    all.length > 1 && isTruncated(all.at(-1) ?? "") ? all.slice(0, -1) : all;
  const [first, second] = complete;
  if (first === undefined) return "";
  const pairFits =
    second !== undefined && first.length + 1 + second.length <= maxCharacters;
  return pairFits && maxSentences > 1 ? `${first} ${second}` : first;
}

/**
 * Leading sentences of a generated description up to the first one that still
 * carries an unresolved `{{ token }}`; empty when the very first sentence does.
 */
export function resolvedLeadingText(text: string): string {
  const sentences = splitSentences(text);
  const unresolvedAt = sentences.findIndex((sentence) =>
    hasUnresolvedToken(sentence),
  );
  const clean =
    unresolvedAt === -1 ? sentences : sentences.slice(0, unresolvedAt);
  return trimDescription(clean.join(" "));
}

/** Formats a rank table compactly: `12` when flat, `9/8/7/6/5` when it varies. */
export function formatByRank(values: readonly number[]): string {
  const rounded = values.map((value) => String(Math.round(value * 100) / 100));
  const first = rounded[0];
  const flat = rounded.every((value) => value === first);
  return flat && first !== undefined ? first : rounded.join("/");
}
