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
import { requireKnownEvidence } from "./glitter-context-refresh-evidence.ts";
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

const EXTRACTION_MODEL = "gpt-5.6-luna";
const SYNTHESIS_MODEL = "gpt-5.6-sol";
const EXTRACTION_MAX_OUTPUT_TOKENS = 2000;
const SYNTHESIS_MAX_OUTPUT_TOKENS = 15_000;
const DETERMINISTIC_SEED = 0;

// A single repair attempt is not enough: gpt-5.6 occasionally emits an
// observation/quote/sample citing a message ID outside its supplied evidence
// set, and because every completion is cached (immutably, keyed by request
// hash) *before* validation, a fixed-seed retry re-reads the same poisoned
// artifact and fails identically forever. Each repair attempt therefore uses a
// distinct seed (`DETERMINISTIC_SEED + attempt`) so it is a genuinely fresh,
// cache-distinct model call while staying deterministic by attempt index — a
// re-run reuses the first attempt that passed. Attempt 0 is the initial call
// (unchanged seed 0, so its cache key is stable); attempts 1..N are repairs.
const MAX_EXTRACTION_REPAIR_ATTEMPTS = 4;
const MAX_SYNTHESIS_REPAIR_ATTEMPTS = 3;

type SummarizedChunk = {
  key: string;
  month: string;
  summary: StyleChunkSummary;
};

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

function validateChunkSummary(
  chunk: StyleEvidenceChunk,
  summary: StyleChunkSummary,
): void {
  const messagesById = new Map(
    chunk.messages.map((message) => [message.messageId, message]),
  );
  const knownIds = new Set(messagesById.keys());
  for (const observation of summary.observations) {
    requireKnownEvidence(
      observation.evidenceMessageIds,
      knownIds,
      `chunk ${chunk.key} observation`,
    );
  }
  const representativeIds = new Set<string>();
  for (const representative of summary.representativeMessages) {
    const message = messagesById.get(representative.messageId);
    if (message?.content !== representative.content) {
      throw new Error(
        `chunk ${chunk.key} returned non-verbatim representative message ${representative.messageId}`,
      );
    }
    if (representativeIds.has(representative.messageId)) {
      throw new Error(
        `chunk ${chunk.key} returned duplicate representative message ${representative.messageId}`,
      );
    }
    representativeIds.add(representative.messageId);
  }
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
  let previous = await runChunkExtraction({
    ...input,
    attempt: 0,
    repair: null,
  });
  let lastError: Error;
  try {
    validateChunkSummary(input.chunk, previous);
    return previous;
  } catch (error: unknown) {
    lastError = z.instanceof(Error).parse(error);
  }
  for (let attempt = 1; attempt <= MAX_EXTRACTION_REPAIR_ATTEMPTS; attempt++) {
    const repaired = await runChunkExtraction({
      ...input,
      attempt,
      repair: { previous, error: lastError.message },
    });
    try {
      validateChunkSummary(input.chunk, repaired);
      return repaired;
    } catch (error: unknown) {
      lastError = z.instanceof(Error).parse(error);
      previous = repaired;
    }
  }
  throw lastError;
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
  const artifact = await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: SYNTHESIS_MODEL,
    callSite,
    request: {
      schemaVersion: 3,
      model: SYNTHESIS_MODEL,
      messages,
      maxCompletionTokens: params.max_completion_tokens,
      reasoningEffort: params.reasoning_effort,
      seed: params.seed,
      responseSchema: "style-card-synthesis-v2",
    },
    responseSchema: CompletionArtifactSchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        estimatedCallCostUsd({
          model: SYNTHESIS_MODEL,
          inputTokenUpperBound: inputTokenUpperBound(JSON.stringify(params)),
          outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
        }),
      );
      const completion = await parseGlitterCompletion(callSite, params);
      const message = completion.choices[0]?.message;
      return glitterCompletionArtifact({
        model: SYNTHESIS_MODEL,
        parsed: message?.parsed,
        rawContent: message?.content ?? null,
        usage: completion.usage,
        missingParsedError: `GPT-5.6 Sol did not return a parsed synthesis for ${input.candidate.person.id}`,
      });
    },
  });
  return useGlitterCompletionArtifact({
    artifact,
    budget: input.budget,
  });
}

export function estimateStyleGenerationCost(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
}): number {
  const chunks = buildStyleEvidenceChunks(input.candidate.safeMessages);
  const extractionCost = chunks.reduce((total, chunk) => {
    const prompt = chunkPrompt({ candidate: input.candidate, chunk });
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
  const synthesisBase = synthesisPrompt({
    candidate: input.candidate,
    existingCard: input.existingCard,
    chunks: [],
    repair: null,
  });
  const synthesisInputUpperBound =
    inputTokenUpperBound(synthesisBase) +
    chunks.length * EXTRACTION_MAX_OUTPUT_TOKENS;
  const synthesisInitialCall = estimatedCallCostUsd({
    model: SYNTHESIS_MODEL,
    inputTokenUpperBound: synthesisInputUpperBound,
    outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
  });
  // A synthesis repair likewise serializes the prior synthesis (bounded by the
  // output cap) plus the error into its request.
  const synthesisRepairCall = estimatedCallCostUsd({
    model: SYNTHESIS_MODEL,
    inputTokenUpperBound:
      synthesisInputUpperBound + SYNTHESIS_MAX_OUTPUT_TOKENS,
    outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
  });
  return (
    extractionCost +
    synthesisInitialCall +
    synthesisRepairCall * MAX_SYNTHESIS_REPAIR_ATTEMPTS
  );
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
