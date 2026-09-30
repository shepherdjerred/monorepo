import type { MediaCandidate } from "@shepherdjerred/streambot/discovery/candidate.ts";

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
      /\b(?:lyrics?(?:\s+video)?|visualizer|hd|4k|remaster(?:ed)?|vevo)\b/giu,
      " ",
    )
    .replaceAll(/\s+-\s+topic\b/giu, " ")
    .replaceAll(/\b(?:video|audio)$/giu, " ")
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

function leftoverPrefix(title: string): string {
  const separator = title.lastIndexOf(" - ");
  return separator === -1 ? "" : canonicalWorkKey(title.slice(0, separator));
}

function channelKey(candidate: MediaCandidate): string {
  return candidate.channel === undefined
    ? ""
    : canonicalWorkKey(candidate.channel);
}

function prefixMatchesChannel(prefix: string, channel: string): boolean {
  if (prefix.length === 0 || channel.length === 0) return false;
  const prefixTokens = prefix.split(" ").filter((token) => token.length > 0);
  const channelTokens = channel.split(" ").filter((token) => token.length > 0);
  return prefixTokens.every((token) =>
    channelTokens.some(
      (channelToken) =>
        channelToken.includes(token) || token.includes(channelToken),
    ),
  );
}

function dashPrefixIsArtist(
  prefix: string,
  group: readonly MediaCandidate[],
): boolean {
  return (
    prefix.length === 0 ||
    group.some((candidate) =>
      prefixMatchesChannel(prefix, channelKey(candidate)),
    )
  );
}

function sameWorkTitle(
  left: string,
  right: string,
  group: readonly MediaCandidate[],
): boolean {
  const leftFull = canonicalWorkKey(left);
  const rightFull = canonicalWorkKey(right);
  if (leftFull === rightFull && leftFull.length > 0) return true;
  const leftKey = workTitleKey(left);
  const rightKey = workTitleKey(right);
  if (leftKey !== rightKey || leftKey.length === 0) return false;
  const leftPrefix = leftoverPrefix(left);
  const rightPrefix = leftoverPrefix(right);
  return (
    leftPrefix === rightPrefix ||
    (dashPrefixIsArtist(leftPrefix, group) &&
      dashPrefixIsArtist(rightPrefix, group))
  );
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
  return candidates.every((candidate) =>
    sameWorkTitle(first.title, candidate.title, candidates),
  )
    ? [...candidates].toSorted(
        (left, right) =>
          ownedMatchScore(right) - ownedMatchScore(left) ||
          officialScore(right) - officialScore(left) ||
          right.score - left.score,
      )[0]
    : undefined;
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
  return max === 0 ? 0 : 1 - levenshtein(left, right) / max;
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
  // word that shares a few letters (`hello`/`yellow`). Same first letter of the
  // best title token keeps Silco while rejecting Hello-for-Yellow. Multi-token
  // retries can keep a weaker first token when another token matches exactly
  // (`suka mode`).
  const queryToken = queryTokens[0];
  if (queryToken !== undefined && queryTokens.length === 1) {
    let bestTitleToken = titleTokens[0] ?? "";
    let bestRatio = 0;
    for (const titleToken of titleTokens) {
      const ratio = tokenRatio(queryToken, titleToken);
      if (ratio > bestRatio) {
        bestTitleToken = titleToken;
        bestRatio = ratio;
      }
    }
    if (!queryToken.startsWith(bestTitleToken.slice(0, 1))) return 0;
  }
  const minimum = queryTokens.length === 1 ? 0.6 : 0.4;
  return weakest >= minimum && (best >= 0.5 || exactCount > 0)
    ? Math.round(average * 100)
    : 0;
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
    const score = asrScore(cleaned, candidate.title);
    if (best === null || score > best.score) {
      best = { candidate, score };
    }
  }
  return best === null || best.score < 50 ? null : best.candidate;
}
