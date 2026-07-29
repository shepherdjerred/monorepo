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
  glitterChatMessages,
  glitterCompletionUsage,
  parseGlitterCompletion,
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
    seed: DETERMINISTIC_SEED,
    response_format: zodResponseFormat(
      StyleChunkSummarySchema,
      "style_chunk_summary",
    ),
  };
  const artifact = await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: EXTRACTION_MODEL,
    callSite,
    request: {
      schemaVersion: 2,
      model: EXTRACTION_MODEL,
      messages,
      maxCompletionTokens: params.max_completion_tokens,
      reasoningEffort: params.reasoning_effort,
      seed: params.seed,
      responseSchema: "style-chunk-summary-v2",
    },
    responseSchema: StyleChunkSummarySchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        estimatedCallCostUsd({
          model: EXTRACTION_MODEL,
          inputTokenUpperBound: inputTokenUpperBound(JSON.stringify(params)),
          outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
        }),
      );
      const completion = await parseGlitterCompletion(callSite, params);
      const parsed = completion.choices[0]?.message.parsed;
      if (parsed === null || parsed === undefined) {
        throw new Error(
          `GPT-5.6 Luna did not return a parsed summary for ${input.chunk.key}`,
        );
      }
      return {
        response: parsed,
        usage: glitterCompletionUsage({
          model: EXTRACTION_MODEL,
          usage: completion.usage,
        }),
      };
    },
  });
  input.budget.record(artifact);
  return artifact.response;
}

async function summarizeChunk(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
}): Promise<StyleChunkSummary> {
  const initial = await runChunkExtraction({ ...input, repair: null });
  try {
    validateChunkSummary(input.chunk, initial);
    return initial;
  } catch (error: unknown) {
    const parsedError = z.instanceof(Error).parse(error);
    const repaired = await runChunkExtraction({
      ...input,
      repair: { previous: initial, error: parsedError.message },
    });
    validateChunkSummary(input.chunk, repaired);
    return repaired;
  }
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
      existingSummary: input.existingCard.summary,
      existingLeague: input.existingCard.league,
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
    seed: DETERMINISTIC_SEED,
    response_format: zodResponseFormat(
      StyleSynthesisSchema,
      "style_card_synthesis",
    ),
  };
  const artifact = await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: SYNTHESIS_MODEL,
    callSite,
    request: {
      schemaVersion: 2,
      model: SYNTHESIS_MODEL,
      messages,
      maxCompletionTokens: params.max_completion_tokens,
      reasoningEffort: params.reasoning_effort,
      seed: params.seed,
      responseSchema: "style-card-synthesis-v2",
    },
    responseSchema: StyleSynthesisSchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        estimatedCallCostUsd({
          model: SYNTHESIS_MODEL,
          inputTokenUpperBound: inputTokenUpperBound(JSON.stringify(params)),
          outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
        }),
      );
      const completion = await parseGlitterCompletion(callSite, params);
      const parsed = completion.choices[0]?.message.parsed;
      if (parsed === null || parsed === undefined) {
        throw new Error(
          `GPT-5.6 Sol did not return a parsed synthesis for ${input.candidate.person.id}`,
        );
      }
      return {
        response: parsed,
        usage: glitterCompletionUsage({
          model: SYNTHESIS_MODEL,
          usage: completion.usage,
        }),
      };
    },
  });
  input.budget.record(artifact);
  return artifact.response;
}

export function estimateStyleGenerationCost(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
}): number {
  const chunks = buildStyleEvidenceChunks(input.candidate.safeMessages);
  const extractionCost = chunks.reduce((total, chunk) => {
    const prompt = chunkPrompt({ candidate: input.candidate, chunk });
    const oneAttempt = estimatedCallCostUsd({
      model: EXTRACTION_MODEL,
      inputTokenUpperBound: inputTokenUpperBound(prompt),
      outputTokenUpperBound: EXTRACTION_MAX_OUTPUT_TOKENS,
    });
    return total + oneAttempt * 2;
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
  const synthesisCost = estimatedCallCostUsd({
    model: SYNTHESIS_MODEL,
    inputTokenUpperBound: synthesisInputUpperBound,
    outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
  });
  return extractionCost + synthesisCost * 2;
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
  const initial = await runSynthesis({
    ...input,
    chunks: summarizedChunks,
    repair: null,
  });
  try {
    return finalizeStyleSynthesis({
      ...input,
      chunkCount: chunks.length,
      synthesis: initial,
    });
  } catch (error: unknown) {
    const parsedError = z.instanceof(Error).parse(error);
    const repaired = await runSynthesis({
      ...input,
      chunks: summarizedChunks,
      repair: { previous: initial, error: parsedError.message },
    });
    return finalizeStyleSynthesis({
      ...input,
      chunkCount: chunks.length,
      synthesis: repaired,
    });
  }
}
