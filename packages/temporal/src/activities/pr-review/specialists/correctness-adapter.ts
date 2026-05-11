/**
 * Phase 3 adapter for the correctness specialist.
 *
 * The legacy `correctness.ts` module is the Phase 2 single-call baseline —
 * its parity tests assert exact constants and the exact `CORRECTNESS_SYSTEM_PROMPT`
 * text. Phase 3 needs the same specialist to participate in the
 * runner-based multi-pass fan-out (with the per-pass diff-permutation and
 * kind-pinning Zod refinement), so we wrap it here rather than rewriting
 * the legacy module and breaking those parity tests.
 *
 * The system prompt + model + effort are re-exported via `CORRECTNESS_CONFIG`;
 * `correctnessSpecialistAdapter` invokes `runSpecialistPass` with that
 * config so this specialist gets identical metrics emission, prompt caching,
 * and output-schema enforcement as the other four.
 */

import { withSpan } from "#observability/tracing.ts";
import type { PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import {
  CORRECTNESS_EFFORT,
  CORRECTNESS_MAX_TOKENS,
  CORRECTNESS_MODEL,
  CORRECTNESS_SYSTEM_PROMPT,
} from "./correctness.ts";
import {
  defaultSpecialistClient,
  runSpecialistPass,
  withSentryCapture,
  type SpecialistConfig,
  type SpecialistRunResult,
} from "./runner.ts";

const MAX_FILES_IN_PROMPT = 150;

export const CORRECTNESS_CONFIG: SpecialistConfig = {
  id: "correctness",
  kind: "correctness",
  model: CORRECTNESS_MODEL,
  effort: CORRECTNESS_EFFORT,
  maxTokens: CORRECTNESS_MAX_TOKENS,
  systemPrompt: CORRECTNESS_SYSTEM_PROMPT,
  maxFilesInPrompt: MAX_FILES_IN_PROMPT,
};

export type CorrectnessAdapterInput = {
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
  passId: number;
};

export async function correctnessSpecialistAdapter(
  input: CorrectnessAdapterInput,
): Promise<SpecialistRunResult> {
  return await withSpan(
    "prReview.correctnessReviewer.pass",
    {
      "pr.owner": input.pipeline.owner,
      "pr.repo": input.pipeline.repo,
      "pr.number": input.pipeline.prNumber,
      "specialist.pass": input.passId,
      "changedFiles.count": input.context.changedFiles.length,
      "claudeMd.count": input.context.claudeMdHierarchy.length,
    },
    async () => {
      const client = defaultSpecialistClient();
      const request = {
        config: CORRECTNESS_CONFIG,
        pipeline: input.pipeline,
        context: input.context,
        passId: input.passId,
      };
      try {
        return await runSpecialistPass(client, request);
      } catch (error: unknown) {
        withSentryCapture(request)(error);
        throw error;
      }
    },
  );
}
