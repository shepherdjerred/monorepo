import type { StyleCard } from "@shepherdjerred/glitter-context/schema";
import {
  estimatedCallCostUsd,
  inputTokenUpperBound,
} from "./glitter-context-refresh-budget.ts";
import {
  buildStyleEvidenceChunks,
  type StyleEvidenceChunk,
} from "./glitter-context-refresh-chunks.ts";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";
import {
  type StyleChunkSummary,
  type StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";

export const EXTRACTION_MODEL = "gpt-5.6-luna";
export const SYNTHESIS_MODEL = "gpt-5.6-sol";
export const EXTRACTION_MAX_OUTPUT_TOKENS = 2000;
export const SYNTHESIS_MAX_OUTPUT_TOKENS = 28_000;
export const SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS = 40_000;
export const MAX_EXTRACTION_REPAIR_ATTEMPTS = 2;
export const MAX_SYNTHESIS_REPAIR_ATTEMPTS = 3;

export type SummarizedChunk = {
  key: string;
  month: string;
  summary: StyleChunkSummary;
};

type StyleSynthesisPromptInput = {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  chunks: readonly SummarizedChunk[];
  repair: {
    previous: StyleSynthesis;
    error: string;
  } | null;
};

type StyleCostPromptBuilders = {
  chunkPrompt: (input: {
    candidate: StyleRefreshCandidate;
    chunk: StyleEvidenceChunk;
  }) => string;
  synthesisPrompt: (input: StyleSynthesisPromptInput) => string;
};

export function estimateStyleGenerationCost(
  input: {
    candidate: StyleRefreshCandidate;
    existingCard: StyleCard;
  },
  prompts: StyleCostPromptBuilders,
): number {
  const chunks = buildStyleEvidenceChunks(input.candidate.safeMessages);
  const extractionCost = chunks.reduce((total, chunk) => {
    const prompt = prompts.chunkPrompt({ candidate: input.candidate, chunk });
    const initialInputTokens = inputTokenUpperBound(prompt);
    const initialCall = estimatedCallCostUsd({
      model: EXTRACTION_MODEL,
      inputTokenUpperBound: initialInputTokens,
      outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
    });
    // Every repair attempt also serializes the prior summary (bounded by the
    // output cap) and the validation error back into its request, so its input
    // is larger than the initial call's.
    const repairCall = estimatedCallCostUsd({
      model: EXTRACTION_MODEL,
      inputTokenUpperBound: initialInputTokens + EXTRACTION_MAX_OUTPUT_TOKENS,
      outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
    });
    return total + initialCall + repairCall * MAX_EXTRACTION_REPAIR_ATTEMPTS;
  }, 0);
  const synthesisBase = prompts.synthesisPrompt({
    candidate: input.candidate,
    existingCard: input.existingCard,
    chunks: [],
    repair: null,
  });
  const synthesisInputUpperBound =
    inputTokenUpperBound(synthesisBase) +
    chunks.length * EXTRACTION_MAX_OUTPUT_TOKENS;
  // A truncated synthesis is billed as two separate calls: the base cap and
  // one retry at the higher ceiling. Include both in the preflight estimate.
  const synthesisInitialCall =
    estimatedCallCostUsd({
      model: SYNTHESIS_MODEL,
      inputTokenUpperBound: synthesisInputUpperBound,
      outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
    }) +
    estimatedCallCostUsd({
      model: SYNTHESIS_MODEL,
      inputTokenUpperBound: synthesisInputUpperBound,
      outputTokenUpperBound: SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    });
  // A synthesis repair likewise serializes the prior synthesis (bounded by the
  // retry ceiling) plus the error into its request, and may incur the same retry.
  const synthesisRepairInput =
    synthesisInputUpperBound + SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS;
  const synthesisRepairCall =
    estimatedCallCostUsd({
      model: SYNTHESIS_MODEL,
      inputTokenUpperBound: synthesisRepairInput,
      outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
    }) +
    estimatedCallCostUsd({
      model: SYNTHESIS_MODEL,
      inputTokenUpperBound: synthesisRepairInput,
      outputTokenUpperBound: SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    });
  return (
    extractionCost +
    synthesisInitialCall +
    synthesisRepairCall * MAX_SYNTHESIS_REPAIR_ATTEMPTS
  );
}
