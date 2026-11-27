import { z } from "zod";
import { TipVerdictSchema } from "#src/tips/eval/judge.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import {
  type EvalReport,
  EvalReportSchema,
  evalReportPath,
} from "#src/tips/eval/report.ts";

/**
 * The Sonnet judge's verdicts over the tips the three generators already wrote
 * (both runs of each), kept apart from the eval reports so those stay as the
 * two reference judges left them. A verdict is addressed by the report it
 * judges (`model#run`), the case's index in that report, the set within the
 * case and the tip within the set.
 */

export const REJUDGE_PATH = `${EVAL_RAW_DIRECTORY}/sonnet-judge.json`;

export const RejudgedCaseSchema = z.strictObject({
  /** `claude-haiku-5-5#1`: the generator model and run whose tips these are. */
  report: z.string(),
  case: z.number().int().nonnegative(),
  /** One list of verdicts per set, in the report's order. */
  sets: z.array(z.array(TipVerdictSchema)),
  costUsd: z.number(),
  toolCalls: z.number().int(),
});
export type RejudgedCase = z.infer<typeof RejudgedCaseSchema>;

const TokensSchema = z.strictObject({
  inputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  outputTokens: z.number().int(),
});

export const RejudgeVariantSchema = z.strictObject({
  /** For example `sonnet-medium`. */
  name: z.string(),
  model: z.string(),
  effort: z.enum(["low", "medium", "high"]),
  jobs: z.number().int(),
  failed: z.number().int(),
  rounds: z.number().int(),
  toolCalls: z.number().int(),
  tokens: TokensSchema,
  /** Cost at the batch tier with the cache, as billed. */
  costUsd: z.number(),
  /** The same tokens at the standard price, nothing cached. */
  listUsd: z.number(),
  cases: z.array(RejudgedCaseSchema),
});
export type RejudgeVariant = z.infer<typeof RejudgeVariantSchema>;

export const RejudgeFileSchema = z.strictObject({
  generatedAt: z.string(),
  judgePromptVersion: z.string(),
  variants: z.array(RejudgeVariantSchema),
});
export type RejudgeFile = z.infer<typeof RejudgeFileSchema>;

export function reportKey(report: Pick<EvalReport, "model" | "run">): string {
  return `${report.model}#${report.run.toString()}`;
}

export async function readReports(
  models: readonly string[],
  runs: readonly number[],
): Promise<EvalReport[]> {
  return Promise.all(
    models.flatMap((model) =>
      runs.map(async (run) =>
        EvalReportSchema.parse(
          await Bun.file(evalReportPath(model, run)).json(),
        ),
      ),
    ),
  );
}
