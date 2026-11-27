import { z } from "zod";
import type { TipVerdict } from "#src/tips/eval/judge.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import type { RejudgeVariant } from "#src/tips/eval/rejudge.ts";

/**
 * The Decisions API judge. OpenAI's `POST /v1/decisions` answers bounded
 * classification questions about an input, several per request, with a
 * calibrated probability for each answer; only `gpt-6-luna` serves it, and it
 * has no tool use, so it judges from the grounding it is given. Each tip gets a
 * correct / wrong / not checkable question and a useful question; the
 * probabilities are kept so a threshold can be chosen afterwards.
 */

export const DECISIONS_PATH = `${EVAL_RAW_DIRECTORY}/decisions-judge.json`;

export const TipScoresSchema = z.strictObject({
  pCorrect: z.number().min(0).max(1),
  pWrong: z.number().min(0).max(1),
  pNotCheckable: z.number().min(0).max(1),
  pUseful: z.number().min(0).max(1),
});
export type TipScores = z.infer<typeof TipScoresSchema>;

export const DecisionCaseSchema = z.strictObject({
  report: z.string(),
  case: z.number().int().nonnegative(),
  /** One list of scores per set, in the report's order. */
  sets: z.array(z.array(TipScoresSchema)),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  milliseconds: z.number().int().nonnegative(),
});
export type DecisionCase = z.infer<typeof DecisionCaseSchema>;

export const DecisionsFileSchema = z.strictObject({
  generatedAt: z.string(),
  model: z.string(),
  /** Requests in flight at once during the run, for reading the latency. */
  concurrency: z.number().int().positive(),
  seconds: z.number(),
  cases: z.array(DecisionCaseSchema),
});
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;

/** A tip's scores as a verdict: the wrong answer wins when it reaches the threshold, else the likeliest answer. */
export function verdictFromScores(
  scores: TipScores,
  wrongThreshold?: number,
): TipVerdict {
  const wrong =
    wrongThreshold === undefined
      ? scores.pWrong > scores.pCorrect && scores.pWrong > scores.pNotCheckable
      : scores.pWrong >= wrongThreshold;
  const correctness = wrong
    ? "wrong"
    : scores.pCorrect >= scores.pNotCheckable
      ? "correct"
      : "not-checkable";
  return {
    correctness,
    useful: scores.pUseful >= 0.5,
    // The Decisions judge is not asked about plain language.
    plain: true,
    reason: `p(wrong)=${scores.pWrong.toFixed(2)}`,
    sources: [],
  };
}

/** The file as a filter variant, so it is measured like any other judge. */
export function variantFromDecisions(
  file: DecisionsFile,
  options: { name: string; wrongThreshold?: number },
): RejudgeVariant {
  const tokens = file.cases.reduce(
    (sum, entry) => ({
      inputTokens:
        sum.inputTokens + entry.inputTokens - entry.cachedInputTokens,
      cacheReadTokens: sum.cacheReadTokens + entry.cachedInputTokens,
    }),
    { inputTokens: 0, cacheReadTokens: 0 },
  );
  const costUsd = file.cases.reduce((sum, entry) => sum + entry.costUsd, 0);
  return {
    name: options.name,
    model: file.model,
    effort: "low",
    jobs: file.cases.length,
    failed: 0,
    rounds: file.cases.length,
    toolCalls: 0,
    tokens: { ...tokens, cacheWriteTokens: 0, outputTokens: 0 },
    costUsd,
    // Standard price of the same tokens: the Decisions price has no batch tier.
    listUsd: costUsd,
    cases: file.cases.map((entry) => ({
      report: entry.report,
      case: entry.case,
      sets: entry.sets.map((set) =>
        set.map((scores) => verdictFromScores(scores, options.wrongThreshold)),
      ),
      costUsd: entry.costUsd,
      toolCalls: 0,
    })),
  };
}

export type LatencySummary = {
  meanMs: number;
  p95Ms: number;
  maxMs: number;
};

export function latencyOf(cases: readonly DecisionCase[]): LatencySummary {
  const sorted = cases
    .map((entry) => entry.milliseconds)
    .toSorted((a, b) => a - b);
  const at = (share: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return {
    meanMs:
      sorted.reduce((sum, value) => sum + value, 0) /
      Math.max(1, sorted.length),
    p95Ms: at(0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}
