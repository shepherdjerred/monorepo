import { z } from "zod/v4";
import {
  type StyleCard,
  type StyleCardV2,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import {
  type GenerationBudget,
  inputTokenUpperBound,
  worstCaseGenerationCostUsd,
} from "./glitter-context-refresh-budget.ts";
import {
  readOrCreateGenerationArtifact,
  type GenerationArtifactResult,
  type GenerationArtifactStore,
} from "./glitter-context-refresh-cache.ts";
import {
  buildStyleEvidenceChunks,
  type StyleEvidenceChunk,
} from "./glitter-context-refresh-chunks.ts";
import { GlitterEvidenceError } from "./glitter-context-refresh-evidence-error.ts";
import {
  generateGlitterObject,
  type GlitterObjectArtifact,
  readGlitterObjectArtifact,
  useGlitterObjectArtifact,
} from "./glitter-context-refresh-llm.ts";
import {
  buildStyleChunkGenerationRequest,
  buildStyleSynthesisGenerationRequest,
  styleChunkPrompt,
  type ChunkExtractionRepair,
} from "./glitter-context-refresh-requests.ts";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";
import {
  estimateStyleGenerationCost as estimateStyleGenerationCostInternal,
  MAX_EXTRACTION_REPAIR_ATTEMPTS,
  MAX_SYNTHESIS_REPAIR_ATTEMPTS,
  type SummarizedChunk,
} from "./glitter-context-refresh-style-generation-cost.ts";
import {
  nextParseFailureRepair,
  selectBestChunkSummary,
  toSummarizedChunk,
  validateChunkSummary,
} from "./glitter-context-refresh-style-validation.ts";
import { finalizeStyleSynthesis } from "./glitter-context-refresh-style-finalize.ts";
import {
  StyleChunkSummarySchema,
  StyleSynthesisSchema,
  type StyleChunkSummary,
  type StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";
import { synthesisPrompt } from "./glitter-context-refresh-synthesis-prompt.ts";

// Names the chunk, like the exhaustion error beside it at the same call site.
// Without the key, a run killed by one truncating chunk says only that *some*
// chunk hit the ceiling — identifying which one meant scanning every cached
// generation artifact out of the corpus bucket.
const extractionTruncationError = (chunkKey: string): string =>
  `GPT-5.6 Luna extraction reached the completion-token limit for ${chunkKey}`;
// gpt-5.6-luna is a reasoning model at `reasoning_effort: "medium"`, so its
// hidden reasoning tokens share `max_completion_tokens` with the (large) style
// synthesis output. Observed live: reasoning + output crossed the former 15k cap
// and truncated (finish_reason=length → unparseable).
// 28k gives comfortable headroom over the observed ~15k usage; if a call still
// truncates, it is retried once at the ceiling below.
const SYNTHESIS_TRUNCATION_ERROR =
  "GPT-5.6 Luna synthesis reached the completion-token limit";
/**
 * Runs one cached Glitter generation call. Chunk extraction and card synthesis
 * differ only in their response schema, schema name, and failure messages —
 * everything around that (artifact reuse, the uncached-call budget
 * authorization, and the token/seed/reasoning wiring) is identical, so it lives
 * here once.
 */
async function generateFromRequest<Value>(input: {
  generationRequest: Omit<
    | ReturnType<typeof buildStyleChunkGenerationRequest>
    | ReturnType<typeof buildStyleSynthesisGenerationRequest>,
    "responseSchema"
  > & { responseSchema: z.ZodType<GlitterObjectArtifact<Value>> };
  budget: GenerationBudget;
  artifactStore: GenerationArtifactStore;
  schema: z.ZodType<Value>;
  schemaName: string;
  truncationError: string;
  exhaustionError: string;
}): Promise<GenerationArtifactResult<GlitterObjectArtifact<Value>>> {
  const { generationRequest } = input;
  return await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: generationRequest.model,
    callSite: generationRequest.callSite,
    request: generationRequest.request,
    responseSchema: generationRequest.responseSchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        worstCaseGenerationCostUsd({
          model: generationRequest.model,
          inputTokenUpperBound: inputTokenUpperBound(
            JSON.stringify(generationRequest.messages),
          ),
          outputTokenUpperBound: generationRequest.maxOutputTokens,
          semanticRetryOutputTokenUpperBound:
            generationRequest.semanticRetryMaxOutputTokens,
        }),
      );
      return await generateGlitterObject({
        model: generationRequest.model,
        schema: input.schema,
        schemaName: input.schemaName,
        ...generationRequest.messages,
        workload: generationRequest.callSite,
        maxOutputTokens: generationRequest.maxOutputTokens,
        semanticRetryMaxOutputTokens:
          generationRequest.semanticRetryMaxOutputTokens,
        reasoningEffort: generationRequest.reasoningEffort,
        seed: generationRequest.seed,
        truncationError: input.truncationError,
        exhaustionError: input.exhaustionError,
      });
    },
  });
}

// Completions are cached before validation, so repairs use distinct seeds
// (`DETERMINISTIC_SEED + attempt`) and cache keys. Attempt 0 is the initial call;
// attempts 1..N are repairs, and a rerun reuses the first passing attempt.
//
// Sanitization is the convergence guarantee when a model repeatedly cites an ID
// found inside content but not in the top-level chunk: unverifiable evidence is
// dropped at the boundary instead of failing the run.
async function runChunkExtraction(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
  attempt: number;
  repair: ChunkExtractionRepair | null;
}) {
  const artifact = await generateFromRequest({
    generationRequest: buildStyleChunkGenerationRequest(input),
    budget: input.budget,
    artifactStore: input.artifactStore,
    schema: StyleChunkSummarySchema,
    schemaName: "style_chunk_summary",
    truncationError: extractionTruncationError(input.chunk.key),
    exhaustionError: `GPT-5.6 Luna did not return a parsed summary for ${input.chunk.key}`,
  });
  return readGlitterObjectArtifact({
    artifact,
    budget: input.budget,
  });
}

async function summarizeChunk(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
}): Promise<StyleChunkSummary> {
  const attempts: StyleChunkSummary[] = [];
  let lastError: Error | undefined;
  let repair: ChunkExtractionRepair | null = null;
  for (let attempt = 0; attempt <= MAX_EXTRACTION_REPAIR_ATTEMPTS; attempt++) {
    const extracted = await runChunkExtraction({
      ...input,
      attempt,
      repair: attempt === 0 ? null : repair,
    });
    if (extracted.outcome === "failure") {
      lastError = new Error(extracted.error);
      repair = nextParseFailureRepair(
        repair,
        extracted.error,
        extracted.rawContent,
      );
      continue;
    }
    attempts.push(extracted.value);
    try {
      validateChunkSummary(input.chunk, extracted.value);
      return extracted.value;
    } catch (error: unknown) {
      lastError = z.instanceof(Error).parse(error);
      repair = {
        previous: extracted.value,
        error: lastError.message,
        rawContent: null,
      };
    }
  }
  if (lastError === undefined) {
    throw new Error(`chunk ${input.chunk.key} produced no extraction attempts`);
  }
  return selectBestChunkSummary(input.chunk, attempts);
}

async function runSynthesis(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  chunks: readonly SummarizedChunk[];
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
  attempt: number;
  repair: {
    previous: StyleSynthesis;
    error: string;
  } | null;
}): Promise<{
  synthesis: StyleSynthesis;
  chunks: readonly SummarizedChunk[];
  directRecentMessages: readonly CurrentMessage[];
}> {
  const generationRequest = buildStyleSynthesisGenerationRequest(input);
  const artifact = await generateFromRequest({
    generationRequest,
    budget: input.budget,
    artifactStore: input.artifactStore,
    schema: StyleSynthesisSchema,
    schemaName: "style_card_synthesis",
    truncationError: SYNTHESIS_TRUNCATION_ERROR,
    exhaustionError: `GPT-5.6 Luna did not return a parsed synthesis for ${input.candidate.person.id}`,
  });
  return {
    synthesis: useGlitterObjectArtifact({ artifact, budget: input.budget }),
    chunks: generationRequest.chunks,
    directRecentMessages: generationRequest.directRecentMessages,
  };
}

export function estimateStyleGenerationCost(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
}): number {
  return estimateStyleGenerationCostInternal(input, {
    chunkPrompt: styleChunkPrompt,
    synthesisPrompt,
  });
}

export async function generateStyleCard(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  sourceSnapshotSha256: string;
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
}): Promise<StyleCardV2> {
  const chunks = buildStyleEvidenceChunks(input.candidate.safeMessages);
  const summarizedChunks: SummarizedChunk[] = [];
  for (const chunk of chunks) {
    const summary = await summarizeChunk({
      candidate: input.candidate,
      chunk,
      artifactStore: input.artifactStore,
      budget: input.budget,
    });
    summarizedChunks.push(toSummarizedChunk(chunk, summary));
  }
  const summarizedMessages = summarizedChunks.reduce(
    (total, chunk) => total + chunk.summarizedMessageCount,
    0,
  );
  // Chunk summaries are not the only evidence: `synthesisPrompt` also hands the
  // model up to DIRECT_RECENT_STYLE_MESSAGES verbatim messages, and finalize
  // validates every quoted and sampled ID against the safe corpus either way. So
  // a person whose chunks all degrade can still get an honest, evidence-backed
  // card — coverage simply reports that no chunk was summarized. Reject only when
  // the model would see nothing at all, which would make the card a fabrication.
  if (
    summarizedMessages === 0 &&
    input.candidate.directRecentMessages.length === 0
  ) {
    throw new GlitterEvidenceError(
      `no evidence for ${input.candidate.person.id}: ${String(chunks.length)} chunks yielded nothing and there are no direct recent messages`,
    );
  }
  const finalizeGenerated = (
    result: Awaited<ReturnType<typeof runSynthesis>>,
    synthesis: StyleSynthesis,
  ): StyleCardV2 =>
    finalizeStyleSynthesis({
      ...input,
      chunks: result.chunks,
      directRecentMessages: result.directRecentMessages,
      omittedChunks: summarizedChunks.length - result.chunks.length,
      omittedSummarizedMessages:
        summarizedMessages -
        result.chunks.reduce(
          (total, chunk) => total + chunk.summarizedMessageCount,
          0,
        ),
      omittedDirectRecentMessages:
        input.candidate.directRecentMessages.length -
        result.directRecentMessages.length,
      synthesis,
    });
  let generated = await runSynthesis({
    ...input,
    chunks: summarizedChunks,
    attempt: 0,
    repair: null,
  });
  let previous = generated.synthesis;
  let lastError: Error;
  try {
    return finalizeGenerated(generated, previous);
  } catch (error: unknown) {
    lastError = z.instanceof(Error).parse(error);
  }
  for (let attempt = 1; attempt <= MAX_SYNTHESIS_REPAIR_ATTEMPTS; attempt++) {
    generated = await runSynthesis({
      ...input,
      chunks: summarizedChunks,
      attempt,
      repair: { previous, error: lastError.message },
    });
    try {
      return finalizeGenerated(generated, generated.synthesis);
    } catch (error: unknown) {
      lastError = z.instanceof(Error).parse(error);
      previous = generated.synthesis;
    }
  }
  // Every bounded synthesis repair produced a card the contract rejects. That is
  // this person's evidence, not a fault in the run.
  throw new GlitterEvidenceError(
    `style synthesis for ${input.candidate.person.id} failed after ${String(MAX_SYNTHESIS_REPAIR_ATTEMPTS)} repairs: ${lastError.message}`,
    { cause: lastError },
  );
}
