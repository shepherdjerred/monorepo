import type { StyleCard } from "@shepherdjerred/glitter-context/schema";
import {
  inputTokenUpperBound,
  worstCaseGenerationCostUsd,
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
export const EXTRACTION_MAX_OUTPUT_TOKENS = 4000;
export const EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS = 8000;
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
    // Each call is priced at the same worst case the budget reserves before it
    // runs, so the preflight estimate can never be lower than what
    // `authorizeUncachedCall` will demand.
    const initialCall = worstCaseGenerationCostUsd({
      model: EXTRACTION_MODEL,
      inputTokenUpperBound: initialInputTokens,
      outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
      semanticRetryOutputTokenUpperBound:
        EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    });
    const repairCall = worstCaseGenerationCostUsd({
      model: EXTRACTION_MODEL,
      inputTokenUpperBound:
        initialInputTokens + EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
      outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
      semanticRetryOutputTokenUpperBound:
        EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
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
  // A truncated synthesis retries at the higher ceiling, so every semantic
  // attempt after the first is priced against that ceiling.
  const synthesisInitialCall = worstCaseGenerationCostUsd({
    model: SYNTHESIS_MODEL,
    inputTokenUpperBound: synthesisInputUpperBound,
    outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
    semanticRetryOutputTokenUpperBound:
      SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
  });
  // A synthesis repair likewise serializes the prior synthesis (bounded by the
  // retry ceiling) plus the error into its request, and may incur the same retry.
  const synthesisRepairInput =
    synthesisInputUpperBound + SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS;
  const synthesisRepairCall = worstCaseGenerationCostUsd({
    model: SYNTHESIS_MODEL,
    inputTokenUpperBound: synthesisRepairInput,
    outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
    semanticRetryOutputTokenUpperBound:
      SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
  });
  return (
    extractionCost +
    synthesisInitialCall +
    synthesisRepairCall * MAX_SYNTHESIS_REPAIR_ATTEMPTS
  );
}
