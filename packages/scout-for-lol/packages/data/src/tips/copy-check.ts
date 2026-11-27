/**
 * Tips are our own words. A tip that shares a run of this many consecutive
 * words with a source text the model saw (the wiki notes it was given, or the
 * search results it read) is a copy, not a tip.
 */
export const COPY_RUN_WORDS = 8;

/** Lowercase words, punctuation and markup dropped, so a copy with different casing or commas still matches. */
export function copyWords(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[‘’]/gu, "'")
    .replaceAll(/[^a-z0-9']+/gu, " ")
    .split(" ")
    .filter((word) => word.length > 0);
}

function runs(words: readonly string[], length: number): Set<string> {
  const found = new Set<string>();
  for (let start = 0; start + length <= words.length; start += 1) {
    found.add(words.slice(start, start + length).join(" "));
  }
  return found;
}

/**
 * The first run of `runLength` or more consecutive words the text shares with
 * any source, or undefined when it shares none.
 */
export function sharedWordRun(
  text: string,
  sources: readonly string[],
  runLength: number = COPY_RUN_WORDS,
): string | undefined {
  const words = copyWords(text);
  if (words.length < runLength) {
    return undefined;
  }
  const mine = runs(words, runLength);
  for (const source of sources) {
    for (const run of runs(copyWords(source), runLength)) {
      if (mine.has(run)) {
        return run;
      }
    }
  }
  return undefined;
}
