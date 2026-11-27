import { z } from "zod";
import { LaneSchema } from "#src/model/riot/lane.ts";
import {
  type Correctness,
  JUDGE_PROMPT_VERSION,
  TipVerdictSchema,
} from "#src/tips/eval/judge.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import type { TipUsage } from "#src/tips/model.ts";

/**
 * The eval's inputs, its per-run report and the committed summary table. One
 * report per generator model and run, every unit judged by the same two judge
 * models (different families) so the scores compare and no model grades itself
 * alone.
 */

export const EVAL_CASES_PATH = `${import.meta.dir}/cases.json`;
export const EVAL_SUMMARY_PATH = `${import.meta.dir}/eval-summary.md`;

export function evalReportPath(model: string, run: number): string {
  return `${EVAL_RAW_DIRECTORY}/eval-report.${model}.run${run.toString()}.json`;
}

/** The generator models the committed summary compares, cheapest first. */
export const EVAL_MODELS = [
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
] as const;

/** Runs per model, so the run-to-run spread shows. */
export const EVAL_RUNS = [1, 2] as const;

export const EvalCasesSchema = z.strictObject({
  matchups: z.array(
    z.strictObject({
      lane: LaneSchema,
      /** Data Dragon keys, as in the generated file names. */
      champion: z.string().min(1),
      opponent: z.string().min(1),
    }),
  ),
  general: z.array(
    z.strictObject({ lane: LaneSchema, champion: z.string().min(1) }),
  ),
});
export type EvalCases = z.infer<typeof EvalCasesSchema>;

export const IssueSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  tip: z.string().optional(),
});
export type IssueRow = z.infer<typeof IssueSchema>;

export const JudgeVerdictRowSchema = TipVerdictSchema.extend({
  /** The judge model that gave the verdict. */
  judge: z.string(),
});
export type JudgeVerdictRow = z.infer<typeof JudgeVerdictRowSchema>;

export const ReportTipSchema = z.strictObject({
  text: z.string(),
  cites: z.array(z.string()),
  /** The sources the generator said the tip rests on; empty for a rejected answer. */
  sources: z.array(z.string()),
  /** One verdict per judge; empty for the rejected answer of a dropped case. */
  verdicts: z.array(JudgeVerdictRowSchema),
});
export type ReportTip = z.infer<typeof ReportTipSchema>;

export const ReportSetSchema = z.strictObject({
  /** The champion the tips are written for. */
  champion: z.string(),
  opponent: z.string().optional(),
  tips: z.array(ReportTipSchema),
});
export type ReportSet = z.infer<typeof ReportSetSchema>;

export const CaseResultSchema = z.strictObject({
  kind: z.enum(["matchup", "general"]),
  lane: LaneSchema,
  champions: z.array(z.string()),
  status: z.enum(["passed-first-attempt", "passed-after-retry", "dropped"]),
  calls: z.number().int().positive(),
  /** Generator cost of the case; the judges' cost is separate. */
  costUsd: z.number().nonnegative(),
  /** `lookup` calls the generator made. */
  toolCalls: z.number().int().nonnegative(),
  /** Wiki pages the accepted generation used (prefetched notes, patch histories, lookups). */
  wikiPages: z.number().int().nonnegative(),
  judgeCostUsd: z.number().nonnegative(),
  judgeToolCalls: z.number().int().nonnegative(),
  firstAttemptIssues: z.array(IssueSchema),
  finalIssues: z.array(IssueSchema),
  /** The accepted sets, or for a dropped case the last rejected answer. */
  sets: z.array(ReportSetSchema),
  glossaryAdditions: z.array(
    z.strictObject({
      id: z.string(),
      term: z.string(),
      aliases: z.array(z.string()),
      definition: z.string(),
    }),
  ),
});
export type EvalCaseResult = z.infer<typeof CaseResultSchema>;

const JudgeTotalsSchema = z.strictObject({
  model: z.string(),
  tips: z.number().int(),
  correct: z.number().int(),
  wrong: z.number().int(),
  notCheckable: z.number().int(),
  useful: z.number().int(),
  plain: z.number().int(),
  correctRate: z.number(),
  wrongRate: z.number(),
  notCheckableRate: z.number(),
  usefulRate: z.number(),
  plainRate: z.number(),
  costUsd: z.number(),
});
export type JudgeTotals = z.infer<typeof JudgeTotalsSchema>;

const AgreementSchema = z.strictObject({
  /** The two judges compared, in order. */
  judges: z.array(z.string()),
  tips: z.number().int(),
  correctnessAgree: z.number().int(),
  correctnessAgreeRate: z.number(),
  /** Cohen's kappa over the three correctness values. */
  kappa: z.number(),
  bothWrong: z.number().int(),
  bothCorrect: z.number().int(),
  bothNotCheckable: z.number().int(),
  eitherWrong: z.number().int(),
  usefulAgreeRate: z.number(),
});
export type Agreement = z.infer<typeof AgreementSchema>;

export const EvalReportSchema = z.strictObject({
  generatedAt: z.string(),
  model: z.string(),
  run: z.number().int().positive(),
  promptVersion: z.string(),
  judgePromptVersion: z.string(),
  totals: z.strictObject({
    cases: z.number().int(),
    matchupCases: z.number().int(),
    generalCases: z.number().int(),
    passedFirstAttempt: z.number().int(),
    passedAfterRetry: z.number().int(),
    dropped: z.number().int(),
    firstAttemptPassRate: z.number(),
    finalPassRate: z.number(),
    calls: z.number().int(),
    toolCalls: z.number().int(),
    toolCallsPerUnit: z.number(),
    wikiPagesPerUnit: z.number(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    /** Generator cost only. */
    costUsd: z.number(),
    costPerCaseUsd: z.number(),
    costPerMatchupCaseUsd: z.number(),
    costPerGeneralCaseUsd: z.number(),
  }),
  judges: z.array(JudgeTotalsSchema),
  agreement: AgreementSchema,
  judgeToolCallsPerUnit: z.number(),
  firstAttemptIssuesByCode: z.record(z.string(), z.number().int()),
  cases: z.array(CaseResultSchema),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 10_000) / 10_000;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function judgedTips(results: readonly EvalCaseResult[]): ReportTip[] {
  return results.flatMap((entry) => entry.sets.flatMap((set) => set.tips));
}

function verdictOf(tip: ReportTip, judge: string): JudgeVerdictRow | undefined {
  return tip.verdicts.find((verdict) => verdict.judge === judge);
}

function judgeTotals(
  judgeModel: string,
  results: readonly EvalCaseResult[],
  costUsd: number,
): JudgeTotals {
  const verdicts = judgedTips(results).flatMap((tip) => {
    const verdict = verdictOf(tip, judgeModel);
    return verdict === undefined ? [] : [verdict];
  });
  const count = (correctness: Correctness): number =>
    verdicts.filter((verdict) => verdict.correctness === correctness).length;
  const useful = verdicts.filter((verdict) => verdict.useful).length;
  const plain = verdicts.filter((verdict) => verdict.plain).length;
  return {
    model: judgeModel,
    tips: verdicts.length,
    correct: count("correct"),
    wrong: count("wrong"),
    notCheckable: count("not-checkable"),
    useful,
    plain,
    correctRate: rate(count("correct"), verdicts.length),
    wrongRate: rate(count("wrong"), verdicts.length),
    notCheckableRate: rate(count("not-checkable"), verdicts.length),
    usefulRate: rate(useful, verdicts.length),
    plainRate: rate(plain, verdicts.length),
    costUsd: roundUsd(costUsd),
  };
}

const CORRECTNESS: readonly Correctness[] = [
  "correct",
  "wrong",
  "not-checkable",
];

/** Agreement of the first two judges on every tip both scored. */
export function judgeAgreement(
  judges: readonly [string, string],
  results: readonly EvalCaseResult[],
): Agreement {
  const pairs = judgedTips(results).flatMap((tip) => {
    const left = verdictOf(tip, judges[0]);
    const right = verdictOf(tip, judges[1]);
    return left === undefined || right === undefined ? [] : [{ left, right }];
  });
  const total = pairs.length;
  const agree = pairs.filter(
    (pair) => pair.left.correctness === pair.right.correctness,
  ).length;
  const marginal = (side: "left" | "right", value: Correctness): number =>
    pairs.filter((pair) => pair[side].correctness === value).length;
  const expected =
    total === 0
      ? 0
      : CORRECTNESS.reduce(
          (sum, value) =>
            sum +
            (marginal("left", value) * marginal("right", value)) / total ** 2,
          0,
        );
  const observed = total === 0 ? 0 : agree / total;
  const both = (value: Correctness): number =>
    pairs.filter(
      (pair) =>
        pair.left.correctness === value && pair.right.correctness === value,
    ).length;
  return {
    judges: [...judges],
    tips: total,
    correctnessAgree: agree,
    correctnessAgreeRate: rate(agree, total),
    kappa:
      expected === 1
        ? 1
        : Math.round(((observed - expected) / (1 - expected)) * 1000) / 1000,
    bothWrong: both("wrong"),
    bothCorrect: both("correct"),
    bothNotCheckable: both("not-checkable"),
    eitherWrong: pairs.filter(
      (pair) =>
        pair.left.correctness === "wrong" || pair.right.correctness === "wrong",
    ).length,
    usefulAgreeRate: rate(
      pairs.filter((pair) => pair.left.useful === pair.right.useful).length,
      total,
    ),
  };
}

export function buildReport(
  options: {
    model: string;
    run: number;
    promptVersion: string;
    judgeModels: readonly [string, string];
    judgeCostUsd: Readonly<Record<string, number>>;
    now: Date;
  },
  results: readonly EvalCaseResult[],
  usage: TipUsage,
): EvalReport {
  const count = (status: EvalCaseResult["status"]): number =>
    results.filter((entry) => entry.status === status).length;
  const matchups = results.filter((entry) => entry.kind === "matchup");
  const general = results.filter((entry) => entry.kind === "general");
  const sum = (entries: readonly EvalCaseResult[]): number =>
    entries.reduce((total, entry) => total + entry.costUsd, 0);
  const passedFirst = count("passed-first-attempt");
  const passedRetry = count("passed-after-retry");
  const byCode: Record<string, number> = {};
  for (const entry of results) {
    for (const issue of entry.firstAttemptIssues) {
      byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
    }
  }
  const units = Math.max(1, results.length);
  const toolCalls = results.reduce(
    (total, entry) => total + entry.toolCalls,
    0,
  );
  const round2 = (value: number): number => Math.round(value * 100) / 100;
  return {
    generatedAt: options.now.toISOString(),
    model: options.model,
    run: options.run,
    promptVersion: options.promptVersion,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    totals: {
      cases: results.length,
      matchupCases: matchups.length,
      generalCases: general.length,
      passedFirstAttempt: passedFirst,
      passedAfterRetry: passedRetry,
      dropped: count("dropped"),
      firstAttemptPassRate: rate(passedFirst, results.length),
      finalPassRate: rate(passedFirst + passedRetry, results.length),
      calls: results.reduce((total, entry) => total + entry.calls, 0),
      toolCalls,
      toolCallsPerUnit: round2(toolCalls / units),
      wikiPagesPerUnit: round2(
        results.reduce((total, entry) => total + entry.wikiPages, 0) / units,
      ),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: roundUsd(usage.costUsd),
      costPerCaseUsd: roundUsd(usage.costUsd / units),
      costPerMatchupCaseUsd: roundUsd(
        sum(matchups) / Math.max(1, matchups.length),
      ),
      costPerGeneralCaseUsd: roundUsd(
        sum(general) / Math.max(1, general.length),
      ),
    },
    judges: options.judgeModels.map((model) =>
      judgeTotals(model, results, options.judgeCostUsd[model] ?? 0),
    ),
    agreement: judgeAgreement(options.judgeModels, results),
    judgeToolCallsPerUnit: round2(
      results.reduce((total, entry) => total + entry.judgeToolCalls, 0) / units,
    ),
    firstAttemptIssuesByCode: Object.fromEntries(
      Object.entries(byCode).toSorted(([left], [right]) =>
        left < right ? -1 : 1,
      ),
    ),
    cases: [...results],
  };
}
