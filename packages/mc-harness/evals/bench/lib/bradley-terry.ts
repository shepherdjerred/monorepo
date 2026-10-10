/**
 * Bradley–Terry strengths from pairwise verdicts, fitted by Hunter's MM
 * iteration. A tie counts as half a win each way. Ratings are reported on an
 * Elo-like scale (400 points per decade of strength) and centred so the mean
 * anchor rating is 1000, which keeps rounds comparable while the anchor set
 * is unchanged. Without anchors the mean of all players is 1000.
 */
export type PairResult = { a: string; b: string; winner: "a" | "b" | "tie" };

export type Rating = {
  rating: number;
  /** Bootstrap 90% interval. */
  lo: number;
  hi: number;
  games: number;
  wins: number;
};

const ITERATIONS = 200;
const MIN = 1e-4;
const MAX = 1e4;

function toRating(strength: number): number {
  return 1000 + 400 * Math.log10(strength);
}

type Tally = { games: number[][]; wins: number[] };

function tally(
  index: Map<string, number>,
  pairs: readonly PairResult[],
): Tally {
  const n = index.size;
  const games = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  );
  const wins = Array.from({ length: n }, () => 0);
  for (const pair of pairs) {
    const a = index.get(pair.a);
    const b = index.get(pair.b);
    if (a === undefined || b === undefined || a === b) continue;
    const rowA = games[a] ?? [];
    const rowB = games[b] ?? [];
    rowA[b] = (rowA[b] ?? 0) + 1;
    rowB[a] = (rowB[a] ?? 0) + 1;
    const creditA = pair.winner === "a" ? 1 : pair.winner === "tie" ? 0.5 : 0;
    wins[a] = (wins[a] ?? 0) + creditA;
    wins[b] = (wins[b] ?? 0) + (1 - creditA);
  }
  return { games, wins };
}

/** One MM step for player `i`: wins over the sum of games / (s_i + s_j). */
function step(tallied: Tally, strength: readonly number[], i: number): number {
  const row = tallied.games[i] ?? [];
  const own = strength[i] ?? 1;
  let denominator = 0;
  for (const [j, played] of row.entries()) {
    if (played === 0) continue;
    denominator += played / (own + (strength[j] ?? 1));
  }
  return denominator === 0
    ? own
    : Math.min(MAX, Math.max(MIN, (tallied.wins[i] ?? 0) / denominator));
}

/** Raw strengths (geometric mean over `centre` = 1). */
export function fitStrengths(
  ids: readonly string[],
  pairs: readonly PairResult[],
  centre: readonly string[],
): Map<string, number> {
  const index = new Map(ids.map((id, position) => [id, position]));
  const tallied = tally(index, pairs);
  let strength = ids.map(() => 1);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    strength = strength.map((_, i) => step(tallied, strength, i));
  }
  const centreIds = centre.filter((id) => index.has(id));
  const reference = centreIds.length > 0 ? centreIds : ids;
  const logs = reference.map((id) =>
    Math.log(strength[index.get(id) ?? 0] ?? 1),
  );
  const meanLog = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const scale = Math.exp(-meanLog);
  return new Map(
    ids.map((id, position) => [id, (strength[position] ?? 1) * scale]),
  );
}

/** Deterministic PRNG (a 32-bit LCG) so bootstrap intervals are reproducible. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function resample(
  pairs: readonly PairResult[],
  random: () => number,
): PairResult[] {
  const out: PairResult[] = [];
  for (const _ of pairs) {
    const pick = pairs[Math.floor(random() * pairs.length)];
    if (pick !== undefined) out.push(pick);
  }
  return out;
}

function quantile(
  sorted: readonly number[],
  fraction: number,
  fallback: number,
): number {
  if (sorted.length === 0) return fallback;
  const at = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[at] ?? fallback;
}

function credit(pair: PairResult, id: string): number {
  if (pair.winner === "tie") return 0.5;
  return (pair.winner === "a" ? pair.a : pair.b) === id ? 1 : 0;
}

/** Ratings with bootstrap intervals; `anchors` centre the scale. */
export function rate(
  ids: readonly string[],
  pairs: readonly PairResult[],
  options: {
    anchors?: readonly string[];
    samples?: number;
    seed?: number;
  } = {},
): Record<string, Rating> {
  const anchors = options.anchors ?? [];
  const samples = options.samples ?? 200;
  const random = prng(options.seed ?? 1);
  const point = fitStrengths(ids, pairs, anchors);
  const draws = new Map<string, number[]>(ids.map((id) => [id, []]));
  for (let sample = 0; sample < samples && pairs.length > 0; sample += 1) {
    const fit = fitStrengths(ids, resample(pairs, random), anchors);
    for (const id of ids) {
      draws.get(id)?.push(toRating(fit.get(id) ?? 1));
    }
  }
  const result: Record<string, Rating> = {};
  for (const id of ids) {
    const rating = toRating(point.get(id) ?? 1);
    const sorted = (draws.get(id) ?? []).toSorted((x, y) => x - y);
    const games = pairs.filter((pair) => pair.a === id || pair.b === id);
    result[id] = {
      rating,
      lo: quantile(sorted, 0.05, rating),
      hi: quantile(sorted, 0.95, rating),
      games: games.length,
      wins: games.reduce((sum, pair) => sum + credit(pair, id), 0),
    };
  }
  return result;
}
