/**
 * A round-robin of order-swapped pairwise judgments. Every verdict is cached
 * by the two sheets' hashes, so re-rating a task after one new entry pays
 * only for that entry's pairs, and `report` never calls a model.
 */
import type { LlmImageInput } from "@shepherdjerred/llm-runtime";
import { judgePair, type AskJudge, judgeFingerprint } from "#build/judge.ts";
import type { JudgeRubric } from "#protocol/build.ts";
import type { PairCache, PairOutcome } from "#evals/bench/lib/entries.ts";

export type Contestant = { id: string; sha256: string; image: LlmImageInput };

/** Every unordered pair once, in a stable order. */
export function schedulePairs<T>(items: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (const [i, a] of items.entries()) {
    for (const b of items.slice(i + 1)) {
      pairs.push([a, b]);
    }
  }
  return pairs;
}

function cacheKey(
  rubric: JudgeRubric,
  model: string,
  a: Contestant,
  b: Contestant,
): { key: string; flipped: boolean } {
  const flipped = a.sha256 > b.sha256;
  const [first, second] = flipped ? [b, a] : [a, b];
  return {
    key: `${rubric}|${judgeFingerprint(rubric)}|${model}|${first.sha256}|${second.sha256}`,
    flipped,
  };
}

function flip(winner: "a" | "b" | "tie"): "a" | "b" | "tie" {
  return winner === "a" ? "b" : winner === "b" ? "a" : "tie";
}

export async function runTournament(
  contestants: readonly Contestant[],
  options: {
    ask: AskJudge;
    model: string;
    rubric: JudgeRubric;
    cache: PairCache;
    onPair?: (outcome: PairOutcome, cached: boolean) => void;
    /**
     * Called with the whole cache after every newly judged pair, so a model
     * call that fails later in the round loses nothing already paid for.
     */
    persist?: (cache: PairCache) => Promise<void>;
  },
): Promise<{ pairs: PairOutcome[]; cache: PairCache; judged: number }> {
  const cache = { ...options.cache };
  const pairs: PairOutcome[] = [];
  let judged = 0;
  for (const [a, b] of schedulePairs(contestants)) {
    const { key, flipped } = cacheKey(options.rubric, options.model, a, b);
    const hit = cache[key];
    let outcome: PairOutcome;
    if (hit === undefined) {
      const verdict = await judgePair(
        a.image,
        b.image,
        options.ask,
        options.model,
      );
      judged += 1;
      outcome = {
        a: a.id,
        b: b.id,
        winner: verdict.winner,
        confidence: verdict.confidence,
        agreed: verdict.agreed,
        reasons: verdict.reasons,
      };
      cache[key] = {
        winner: flipped ? flip(verdict.winner) : verdict.winner,
        confidence: verdict.confidence,
        agreed: verdict.agreed,
        reasons: verdict.reasons,
        at: new Date().toISOString(),
      };
      await options.persist?.(cache);
    } else {
      outcome = {
        a: a.id,
        b: b.id,
        winner: flipped ? flip(hit.winner) : hit.winner,
        confidence: hit.confidence,
        agreed: hit.agreed,
        reasons: hit.reasons,
      };
    }
    pairs.push(outcome);
    options.onPair?.(outcome, hit !== undefined);
  }
  return { pairs, cache, judged };
}
