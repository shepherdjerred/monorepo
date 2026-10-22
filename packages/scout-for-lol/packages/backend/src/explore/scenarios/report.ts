import { z } from "zod";
import { ExploreScenarioSurfaceSchema } from "@scout-for-lol/data";

/**
 * The committed summary of a scenario run.
 *
 * Verdicts only — no answers, no judge reasons, no Riot IDs. The fixtures
 * point at real prod accounts, so anything the model wrote can name a real
 * player, and this file lives in a public repository. The full evidence goes
 * to the private bundle under the user's state directory instead, the same
 * split the replay harness makes.
 */

export const ScenarioTurnSummarySchema = z.strictObject({
  index: z.number().int().nonnegative(),
  status: z.enum(["ok", "error", "timeout"]),
  checks: z.array(z.strictObject({ name: z.string(), passed: z.boolean() })),
  /** One entry per rubric criterion, in corpus order; null when unjudged. */
  rubric: z.array(z.boolean()).nullable(),
  passed: z.boolean(),
});

export const ScenarioRunSummarySchema = z.strictObject({
  caseId: z.string(),
  surface: ExploreScenarioSurfaceSchema,
  control: z.boolean(),
  passed: z.boolean(),
  turns: z.array(ScenarioTurnSummarySchema),
});
export type ScenarioRunSummary = z.infer<typeof ScenarioRunSummarySchema>;

export const ScenarioEvalReportSchema = z.strictObject({
  version: z.literal(1),
  corpusVersion: z.number().int().positive(),
  corpusSha256: z.string().length(64),
  model: z.string(),
  judgeModel: z.string().nullable(),
  lakeBuildId: z.string(),
  generatedAt: z.iso.datetime(),
  /** Every run passed. A baseline is expected to be false. */
  passed: z.boolean(),
  summary: z.strictObject({
    runs: z.number().int().nonnegative(),
    passedRuns: z.number().int().nonnegative(),
    /** Controls guard the harness: a failing control means the run is not evidence. */
    failedControls: z.array(z.string()),
    checks: z.strictObject({
      passed: z.number().int(),
      total: z.number().int(),
    }),
    rubric: z.strictObject({ met: z.number().int(), total: z.number().int() }),
  }),
  runs: z.array(ScenarioRunSummarySchema),
});
export type ScenarioEvalReport = z.infer<typeof ScenarioEvalReportSchema>;

export function summarizeScenarioRuns(
  runs: readonly ScenarioRunSummary[],
): ScenarioEvalReport["summary"] {
  const turns = runs.flatMap((run) => run.turns);
  const checks = turns.flatMap((turn) => turn.checks);
  const rubric = turns.flatMap((turn) => turn.rubric ?? []);
  return {
    runs: runs.length,
    passedRuns: runs.filter((run) => run.passed).length,
    failedControls: runs
      .filter((run) => run.control && !run.passed)
      .map((run) => `${run.caseId}/${run.surface}`),
    checks: {
      passed: checks.filter((check) => check.passed).length,
      total: checks.length,
    },
    rubric: { met: rubric.filter(Boolean).length, total: rubric.length },
  };
}

/**
 * A turn passes when every deterministic check passes and every criterion is
 * met. An unjudged turn passes on checks alone, and the report says it was
 * unjudged — a `--no-judge` run is a smoke test, not a score.
 */
export function turnPassed(input: {
  readonly status: "ok" | "error" | "timeout";
  readonly checks: readonly { readonly passed: boolean }[];
  readonly rubric: readonly boolean[] | null;
}): boolean {
  return (
    input.status === "ok" &&
    input.checks.every((check) => check.passed) &&
    (input.rubric ?? []).every(Boolean)
  );
}
