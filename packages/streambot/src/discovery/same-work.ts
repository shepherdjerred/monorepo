import type { MediaCandidate } from "@shepherdjerred/streambot/discovery/candidate.ts";
import { scoreLibraryTitle } from "@shepherdjerred/streambot/sources/library.ts";

/**
 * Strip official-video / lyrics / remaster noise so five SICKO MODE uploads collapse to one work.
 */
export function canonicalWorkKey(title: string): string {
  return title
    .toLocaleLowerCase("en-US")
    .replaceAll(/\([^)]*official[^)]*\)/giu, " ")
    .replaceAll(/\[[^\]]*official[^\]]*\]/giu, " ")
    .replaceAll(
      /\b(?:official|video|audio|lyrics?|visualizer|hd|4k|remaster(?:ed)?|topic|vevo)\b/giu,
      " ",
    )
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function officialScore(candidate: MediaCandidate): number {
  const title = candidate.title.toLocaleLowerCase("en-US");
  const channel = candidate.channel?.toLocaleLowerCase("en-US") ?? "";
  let score = 0;
  if (/\bofficial\b/u.test(title) && /\bvideo\b/u.test(title)) score += 40;
  else if (/\bofficial\b/u.test(title)) score += 30;
  if (/\blyric/u.test(title)) score -= 10;
  if (channel.includes("topic")) score -= 20;
  if (channel.includes("vevo")) score += 15;
  return score;
}

function sameWorkKey(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length === 0 || right.length === 0) return false;
  const leftTokens = left.split(" ").filter((token) => token.length > 0);
  const rightTokens = right.split(" ").filter((token) => token.length > 0);
  // A one-token key matching as a substring would collapse "Love" into "Love Story".
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  return ` ${longer} `.includes(` ${shorter} `);
}

/**
 * When every ranked hit is the same work, return the official/best one instead of asking 1/2/3.
 */
export function pickOfficialSameWork(
  candidates: readonly MediaCandidate[],
): MediaCandidate | undefined {
  if (candidates.length < 2) return undefined;
  const keys = candidates.map((candidate) => canonicalWorkKey(candidate.title));
  const first = keys[0];
  if (first === undefined || first.length === 0) return undefined;
  if (!keys.every((key) => sameWorkKey(first, key))) return undefined;
  return [...candidates].toSorted(
    (left, right) =>
      officialScore(right) - officialScore(left) || right.score - left.score,
  )[0];
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const leftIndexes = Array.from({ length: left.length }, (_, index) => index);
  const rightIndexes = Array.from(
    { length: right.length },
    (_, index) => index,
  );
  for (const row of leftIndexes) {
    const current = [row + 1];
    for (const column of rightIndexes) {
      const insertion = (current[column] ?? 0) + 1;
      const deletion = (previous[column + 1] ?? 0) + 1;
      const substitution =
        (previous[column] ?? 0) + (left[row] === right[column] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function searchable(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

function tokenRatio(left: string, right: string): number {
  const max = Math.max(left.length, right.length);
  if (max === 0) return 0;
  return 1 - levenshtein(left, right) / max;
}

function asrScore(query: string, title: string): number {
  const queryTokens = searchable(query)
    .split(" ")
    .filter((token) => token.length >= 3);
  const titleTokens = searchable(title)
    .split(" ")
    .filter((token) => token.length >= 3);
  if (queryTokens.length === 0 || titleTokens.length === 0) return 0;
  const ratios = queryTokens.map((queryToken) =>
    Math.max(
      ...titleTokens.map((titleToken) => tokenRatio(queryToken, titleToken)),
    ),
  );
  const exactCount = ratios.filter((ratio) => ratio >= 0.99).length;
  const best = Math.max(...ratios);
  const average =
    ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length;
  if (best >= 0.5 || (exactCount > 0 && best >= 0.4)) {
    return Math.round(average * 100);
  }
  return 0;
}

/**
 * Reuse a pending disambiguation list for ASR-garbled retries ("Silco" / "Suka" → SICKO MODE).
 */
export function fuzzyMatchCandidate(
  candidates: readonly MediaCandidate[],
  query: string,
): MediaCandidate | null {
  let best: {
    readonly candidate: MediaCandidate;
    readonly score: number;
  } | null = null;
  for (const candidate of candidates) {
    const score = Math.max(
      scoreLibraryTitle(candidate.title, query),
      asrScore(query, candidate.title),
    );
    if (best === null || score > best.score) {
      best = { candidate, score };
    }
  }
  if (best === null || best.score < 50) return null;
  return best.candidate;
}
