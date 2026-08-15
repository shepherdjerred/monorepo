import {
  generateValidatedObject,
  StructuredOutputExhaustionError,
  type GenerateValidatedObjectResult,
  type OpenRouterRuntime,
} from "@shepherdjerred/llm-runtime";
import { REPORT_AI_MAX_OUTPUT_TOKENS } from "@scout-for-lol/data";
import { recordTokenUsage } from "#src/league/review/openai-budget.ts";
import { scoutReportAiTokensUsedTotal } from "#src/metrics/report-ai.ts";
import { ValidatedReportAiFinalDraftSchema } from "#src/reports/ai/report-query-final-schema.ts";

const FINALIZER_SYSTEM_PROMPT =
  "Finalize a ScoutQL report draft using only the recorded tool-loop evidence. Do not call tools or invent validation/preview results. Return warnings for unresolved limitations.";

function chargeFinalizerTokens(
  model: string,
  tokens: { input: number; output: number },
): void {
  scoutReportAiTokensUsedTotal.inc({ model, kind: "prompt" }, tokens.input);
  scoutReportAiTokensUsedTotal.inc(
    { model, kind: "completion" },
    tokens.output,
  );
  recordTokenUsage(tokens.input, tokens.output, model);
}

/**
 * Runs the structured finalizer and charges its tokens on both outcomes.
 *
 * `generateValidatedObject` may issue several billable generations before it
 * gives up, and the exhaustion error carries the aggregate usage of all of
 * them. Charging only the success path would let repeated exhausted edits spend
 * real tokens that `assertWithinBudget()` never observes, so the budget
 * counters are moved before the error propagates.
 */
export async function finalizeReportDraft(input: {
  runtime: OpenRouterRuntime;
  model: string;
  runId: string;
  prompt: string;
  evidence: string;
  abortSignal: AbortSignal;
}): Promise<
  GenerateValidatedObjectResult<typeof ValidatedReportAiFinalDraftSchema>
> {
  try {
    const finalized = await generateValidatedObject(input.runtime, {
      model: input.model,
      schema: ValidatedReportAiFinalDraftSchema,
      schemaName: "scout_report_query_draft",
      system: FINALIZER_SYSTEM_PROMPT,
      prompt: `${input.prompt}\n\nRecorded tool-loop evidence:\n${input.evidence}`,
      workload: "scout.report-query.finalize",
      sessionId: input.runId,
      abortSignal: input.abortSignal,
      maxOutputTokens: REPORT_AI_MAX_OUTPUT_TOKENS,
    });
    chargeFinalizerTokens(input.model, finalized.usage.tokens);
    return finalized;
  } catch (error: unknown) {
    if (error instanceof StructuredOutputExhaustionError) {
      chargeFinalizerTokens(input.model, error.usage.tokens);
    }
    throw error;
  }
}
