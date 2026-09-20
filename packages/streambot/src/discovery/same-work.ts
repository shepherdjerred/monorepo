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
      /\bofficial(?:\s+music)?(?:\s+lyrics?)?(?:\s+video|\s+audio|\s+visualizer)?\b/giu,
      " ",
    )
    .replaceAll(
      /\b(?:lyrics?(?:\s+video)?|visualizer|hd|4k|remaster(?:ed)?|topic|vevo)\b/giu,
      " ",
    )
    .replaceAll(/\b(video|audio)$/giu, " ")
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

function workTitleKey(title: string): string {
  const separator = title.lastIndexOf(" - ");
  return canonicalWorkKey(
    separator === -1 ? title : title.slice(separator + 3),
  );
}

function sameWorkTitle(left: string, right: string): boolean {
  const leftKey = workTitleKey(left);
  const rightKey = workTitleKey(right);
  return leftKey.length > 0 && leftKey === rightKey;
}

function ownedMatchScore(candidate: MediaCandidate): number {
  return candidate.provider === "local" || candidate.provider === "history"
    ? 1
    : 0;
}

/**
 * When every ranked hit is the same work, return the official/best one instead of asking 1/2/3.
 */
export function pickOfficialSameWork(
  candidates: readonly MediaCandidate[],
): MediaCandidate | undefined {
  if (candidates.length < 2) return undefined;
  const first = candidates[0];
  if (first === undefined || workTitleKey(first.title).length === 0)
    return undefined;
  if (
    !candidates.every((candidate) =>
      sameWorkTitle(first.title, candidate.title),
    )
  )
    return undefined;
  return [...candidates].toSorted(
    (left, right) =>
      ownedMatchScore(right) - ownedMatchScore(left) ||
      officialScore(right) - officialScore(left) ||
      right.score - left.score,
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
  const weakest = Math.min(...ratios);
  // A single token must be a close ASR hit (`silco`/`sicko`), not a different
  // word that shares a few letters (`psycho`/`sicko`). Multi-token retries can
  // keep a weaker first token when another token matches exactly (`suka mode`).
  const minimum = queryTokens.length === 1 ? 0.6 : 0.4;
  if (weakest >= minimum && (best >= 0.5 || exactCount > 0)) {
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
  const cleaned = query.replace(
    /^(?:play|watch|queue|listen to|put on)\s+/iu,
    "",
  );
  let best: {
    readonly candidate: MediaCandidate;
    readonly score: number;
  } | null = null;
  for (const candidate of candidates) {
    const score = Math.max(
      scoreLibraryTitle(candidate.title, cleaned),
      asrScore(cleaned, candidate.title),
    );
    if (best === null || score > best.score) {
      best = { candidate, score };
    }
  }
  if (best === null || best.score < 50) return null;
  return best.candidate;
}
