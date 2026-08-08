import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod/v4";
import {
  type StyleCard,
  type StyleCardV2,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import {
  estimatedCallCostUsd,
  type GenerationBudget,
  inputTokenUpperBound,
} from "./glitter-context-refresh-budget.ts";
import {
  readOrCreateGenerationArtifact,
  type GenerationArtifactStore,
} from "./glitter-context-refresh-cache.ts";
import {
  buildStyleEvidenceChunks,
  type StyleEvidenceChunk,
} from "./glitter-context-refresh-chunks.ts";
import {
  glitterCompletionArtifact,
  glitterCompletionArtifactSchema,
  glitterChatMessages,
  parseGlitterCompletion,
  useGlitterCompletionArtifact,
} from "./glitter-context-refresh-openai.ts";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";
import {
  estimateStyleGenerationCost as estimateStyleGenerationCostInternal,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_MODEL,
  MAX_EXTRACTION_REPAIR_ATTEMPTS,
  MAX_SYNTHESIS_REPAIR_ATTEMPTS,
  SYNTHESIS_MAX_OUTPUT_TOKENS,
  SYNTHESIS_MODEL,
  SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
  type SummarizedChunk,
} from "./glitter-context-refresh-style-generation-cost.ts";
import {
  sanitizeChunkSummary,
  validateChunkSummary,
} from "./glitter-context-refresh-style-validation.ts";
import {
  finalizeStyleSynthesis,
  priorFieldValues,
} from "./glitter-context-refresh-style-finalize.ts";
import {
  STYLE_ARRAY_FIELDS,
  StyleChunkSummarySchema,
  StyleSynthesisSchema,
  type StyleChunkSummary,
  type StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";

// gpt-5.6-sol is a reasoning model at `reasoning_effort: "medium"`, so its
// hidden reasoning tokens share `max_completion_tokens` with the (large) style
// synthesis output. Observed live: reasoning + output crossed the former 15k cap
// and truncated (finish_reason=length → unparseable).
// 28k gives comfortable headroom over the observed ~15k usage; if a call still
// truncates, it is retried once at the ceiling below.
const SYNTHESIS_TRUNCATION_ERROR =
  "GPT-5.6 Sol synthesis reached the completion-token limit";
const DETERMINISTIC_SEED = 0;

// Completions are cached before validation, so repairs use distinct seeds
// (`DETERMINISTIC_SEED + attempt`) and cache keys. Attempt 0 is the initial call;
// attempts 1..N are repairs, and a rerun reuses the first passing attempt.
//
// Sanitization is the convergence guarantee when a model repeatedly cites an ID
// found inside content but not in the top-level chunk: unverifiable evidence is
// dropped at the boundary instead of failing the run.
function messageEvidence(message: CurrentMessage): {
  messageId: string;
  timestamp: string;
  content: string;
} {
  return {
    messageId: message.messageId,
    timestamp: message.timestamp,
    content: message.content,
  };
}

function chunkPrompt(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
}): string {
  return [
    "Extract evidence-grounded writing-style observations from this one UTC-month chunk.",
    "Cite exact supplied message IDs for every observation.",
    "Representative messages must copy both messageId and content byte-for-byte.",
    "Focus on voice, phrasing, topics, relationships, behavior, personality,",
    "humor/tone, likes/dislikes, games, mimic guidance, and review concerns.",
    "Do not infer sensitive traits, diagnoses, identity, or private facts.",
    "",
    JSON.stringify({
      person: {
        id: input.candidate.person.id,
        displayName: input.candidate.person.displayName,
      },
      chunk: {
        key: input.chunk.key,
        month: input.chunk.month,
        messages: input.chunk.messages.map((message) =>
          messageEvidence(message),
        ),
      },
    }),
  ].join("\n");
}

async function runChunkExtraction(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
  attempt: number;
  repair: {
    previous: StyleChunkSummary;
    error: string;
  } | null;
}): Promise<StyleChunkSummary> {
  const basePrompt = chunkPrompt(input);
  const prompt =
    input.repair === null
      ? basePrompt
      : [
          basePrompt,
          "",
          "Repair the prior structured output so it satisfies the evidence contract.",
          JSON.stringify(input.repair),
        ].join("\n");
  const callSite =
    input.repair === null
      ? "glitter-style-chunk"
      : "glitter-style-chunk-repair";
  const messages = glitterChatMessages(
    "You extract compact, cited style evidence for later synthesis.",
    prompt,
  );
  const params = {
    model: EXTRACTION_MODEL,
    messages,
    max_completion_tokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    reasoning_effort: "none" as const,
    seed: DETERMINISTIC_SEED + input.attempt,
    response_format: zodResponseFormat(
      StyleChunkSummarySchema,
      "style_chunk_summary",
    ),
  };
  const CompletionArtifactSchema = glitterCompletionArtifactSchema(
    StyleChunkSummarySchema,
  );
  const artifact = await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: EXTRACTION_MODEL,
    callSite,
    request: {
      schemaVersion: 3,
      model: EXTRACTION_MODEL,
      messages,
      maxCompletionTokens: params.max_completion_tokens,
      reasoningEffort: params.reasoning_effort,
      seed: params.seed,
      responseSchema: "style-chunk-summary-v2",
    },
    responseSchema: CompletionArtifactSchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        estimatedCallCostUsd({
          model: EXTRACTION_MODEL,
          inputTokenUpperBound: inputTokenUpperBound(JSON.stringify(params)),
          outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
        }),
      );
      const completion = await parseGlitterCompletion(callSite, params);
      const message = completion.choices[0]?.message;
      return glitterCompletionArtifact({
        model: EXTRACTION_MODEL,
        parsed: message?.parsed,
        rawContent: message?.content ?? null,
        usage: completion.usage,
        missingParsedError: `GPT-5.6 Luna did not return a parsed summary for ${input.chunk.key}`,
      });
    },
  });
  return useGlitterCompletionArtifact({
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
  // Keep every attempt's raw output: repairs are non-monotonic (a later repair
  // can cite fewer valid IDs than an earlier one), so the fallback must consider
  // all of them, not just the last.
  const attempts: StyleChunkSummary[] = [];
  let lastError: Error;
  const initial = await runChunkExtraction({
    ...input,
    attempt: 0,
    repair: null,
  });
  attempts.push(initial);
  try {
    validateChunkSummary(input.chunk, initial);
    return initial;
  } catch (error: unknown) {
    lastError = z.instanceof(Error).parse(error);
  }
  for (let attempt = 1; attempt <= MAX_EXTRACTION_REPAIR_ATTEMPTS; attempt++) {
    const repaired = await runChunkExtraction({
      ...input,
      attempt,
      repair: {
        previous: attempts.at(-1) ?? initial,
        error: lastError.message,
      },
    });
    attempts.push(repaired);
    try {
      validateChunkSummary(input.chunk, repaired);
      return repaired;
    } catch (error: unknown) {
      lastError = z.instanceof(Error).parse(error);
    }
  }
  // The model could not produce a fully valid summary for this chunk even after
  // repairs (it deterministically cites an unverifiable in-content ID). Sanitize
  // every attempt and keep the one that retains the most verifiable evidence, so
  // an earlier attempt's valid observations are not lost to a worse final repair.
  const verifiableContent = (summary: StyleChunkSummary): number =>
    summary.observations.length + summary.representativeMessages.length;
  const best = attempts
    .map((attempt) => sanitizeChunkSummary(input.chunk, attempt))
    .reduce((strongest, candidate) =>
      verifiableContent(candidate) > verifiableContent(strongest)
        ? candidate
        : strongest,
    );
  // Fail only when *every* attempt sanitizes to nothing: a chunk that yields zero
  // verifiable evidence from its entire month would otherwise let the card
  // advertise full coverage (finalize still counts these messages as summarized)
  // while silently omitting the month, so fail loudly instead of laundering the gap.
  if (verifiableContent(best) === 0) {
    throw new Error(
      `chunk ${input.chunk.key} yielded no verifiable evidence after ${String(MAX_EXTRACTION_REPAIR_ATTEMPTS)} repair attempts and sanitization (last error: ${lastError.message})`,
    );
  }
  // Validate the sanitized result to prove it now satisfies the contract.
  validateChunkSummary(input.chunk, best);
  return best;
}

function synthesisPrompt(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  chunks: readonly SummarizedChunk[];
  repair: {
    previous: StyleSynthesis;
    error: string;
  } | null;
}): string {
  const base = [
    "Patch this human-reviewed style card from complete safe-corpus evidence.",
    "Return one patch for every listed array field and one decision for every prior index.",
    "Also patch every prior summary item and every prior League entry by index.",
    "Retain prior observations unless contradicted or explicitly judged low-confidence.",
    "Retained observations are copied by the application; do not rewrite them.",
    "Contradicted removals require corpus evidence. Low-confidence removals must use",
    "confidence <= 0.3 and explain the judgment.",
    "Additions require confidence >= 0.7 and cited message IDs.",
    "Choose 20 unique quote IDs and 30 unique sample IDs from the safe evidence.",
    "Situational examples are synthetic and must contain exactly three per mood.",
    "Keep descriptive prose close to the prior card; application validation enforces 85-115%.",
    "Do not infer sensitive traits, diagnoses, identity, or private facts.",
    "",
    JSON.stringify({
      person: {
        id: input.candidate.person.id,
        displayName: input.candidate.person.displayName,
      },
      patchFields: STYLE_ARRAY_FIELDS.map((field) => ({
        field,
        prior: priorFieldValues(input.existingCard, field).map(
          (value, priorIndex) => ({ priorIndex, value }),
        ),
      })),
      summaryPatch: {
        prior:
          typeof input.existingCard.summary === "string"
            ? [{ priorIndex: 0, value: input.existingCard.summary }]
            : input.existingCard.summary.map((value, priorIndex) => ({
                priorIndex,
                value,
              })),
      },
      leaguePatch: {
        prior: Object.entries(input.existingCard.league).map(
          ([key, value], priorIndex) => ({ priorIndex, key, value }),
        ),
      },
      chunkSummaries: input.chunks,
      directRecentMessages: input.candidate.directRecentMessages.map(
        (message) => messageEvidence(message),
      ),
    }),
  ].join("\n");
  return input.repair === null
    ? base
    : [
        base,
        "",
        "Repair the prior structured output so it passes deterministic validation.",
        JSON.stringify(input.repair),
      ].join("\n");
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
}): Promise<StyleSynthesis> {
  const prompt = synthesisPrompt(input);
  const callSite =
    input.repair === null
      ? "glitter-style-synthesis"
      : "glitter-style-synthesis-repair";
  const messages = glitterChatMessages(
    "You synthesize evidence-grounded writing-style patches for human review.",
    prompt,
  );
  const params = {
    model: SYNTHESIS_MODEL,
    messages,
    max_completion_tokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
    reasoning_effort: "medium" as const,
    seed: DETERMINISTIC_SEED + input.attempt,
    response_format: zodResponseFormat(
      StyleSynthesisSchema,
      "style_card_synthesis",
    ),
  };
  const CompletionArtifactSchema =
    glitterCompletionArtifactSchema(StyleSynthesisSchema);
  const createArtifact = async (
    inputParams: typeof params,
    inputCallSite: string,
  ) =>
    readOrCreateGenerationArtifact({
      store: input.artifactStore,
      model: SYNTHESIS_MODEL,
      callSite: inputCallSite,
      request: {
        schemaVersion: 3,
        model: SYNTHESIS_MODEL,
        messages: inputParams.messages,
        maxCompletionTokens: inputParams.max_completion_tokens,
        truncationRetryMaxCompletionTokens:
          SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
        reasoningEffort: inputParams.reasoning_effort,
        seed: inputParams.seed,
        responseSchema: "style-card-synthesis-v2",
      },
      responseSchema: CompletionArtifactSchema,
      generate: async () => {
        input.budget.authorizeUncachedCall(
          estimatedCallCostUsd({
            model: SYNTHESIS_MODEL,
            inputTokenUpperBound: inputTokenUpperBound(
              JSON.stringify(inputParams),
            ),
            outputTokenUpperBound: inputParams.max_completion_tokens,
          }),
        );
        const completion = await parseGlitterCompletion(
          inputCallSite,
          inputParams,
        );
        const message = completion.choices[0]?.message;
        return glitterCompletionArtifact({
          model: SYNTHESIS_MODEL,
          parsed: message?.parsed,
          rawContent: message?.content ?? null,
          usage: completion.usage,
          ...(completion.choices[0]?.finish_reason === "length"
            ? { failureError: SYNTHESIS_TRUNCATION_ERROR }
            : {}),
          missingParsedError: `GPT-5.6 Sol did not return a parsed synthesis for ${input.candidate.person.id}`,
        });
      },
    });
  const artifact = await createArtifact(params, callSite);
  if (
    artifact.response.outcome === "failure" &&
    artifact.response.error === SYNTHESIS_TRUNCATION_ERROR
  ) {
    input.budget.record(artifact);
    const retryParams = {
      ...params,
      max_completion_tokens: SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    };
    const retryArtifact = await createArtifact(
      retryParams,
      `${callSite}-truncation-retry`,
    );
    return useGlitterCompletionArtifact({
      artifact: retryArtifact,
      budget: input.budget,
    });
  }
  return useGlitterCompletionArtifact({ artifact, budget: input.budget });
}

export function estimateStyleGenerationCost(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
}): number {
  return estimateStyleGenerationCostInternal(input, {
    chunkPrompt,
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
    summarizedChunks.push({
      key: chunk.key,
      month: chunk.month,
      summary: await summarizeChunk({
        candidate: input.candidate,
        chunk,
        artifactStore: input.artifactStore,
        budget: input.budget,
      }),
    });
  }
  let previous = await runSynthesis({
    ...input,
    chunks: summarizedChunks,
    attempt: 0,
    repair: null,
  });
  let lastError: Error;
  try {
    return finalizeStyleSynthesis({
      ...input,
      chunkCount: chunks.length,
      synthesis: previous,
    });
  } catch (error: unknown) {
    lastError = z.instanceof(Error).parse(error);
  }
  for (let attempt = 1; attempt <= MAX_SYNTHESIS_REPAIR_ATTEMPTS; attempt++) {
    const repaired = await runSynthesis({
      ...input,
      chunks: summarizedChunks,
      attempt,
      repair: { previous, error: lastError.message },
    });
    try {
      return finalizeStyleSynthesis({
        ...input,
        chunkCount: chunks.length,
        synthesis: repaired,
      });
    } catch (error: unknown) {
      lastError = z.instanceof(Error).parse(error);
      previous = repaired;
    }
  }
  throw lastError;
}
