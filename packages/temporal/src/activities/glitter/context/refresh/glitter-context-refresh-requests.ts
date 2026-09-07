import { z } from "zod/v4";
import {
  RelationshipDirectionSchema,
  RelationshipKindSchema,
  type RelationshipEvent,
  type StyleCard,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import type { StyleEvidenceChunk } from "./glitter-context-refresh-chunks.ts";
import {
  glitterObjectArtifactSchema,
  glitterPrompt,
} from "./glitter-context-refresh-llm.ts";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";
import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_MODEL,
  EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
  SYNTHESIS_MAX_OUTPUT_TOKENS,
  SYNTHESIS_MODEL,
  SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
  type SummarizedChunk,
} from "./glitter-context-refresh-style-generation-cost.ts";
import {
  StyleChunkSummarySchema,
  StyleSynthesisSchema,
  type StyleChunkSummary,
  type StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";
import { buildBoundedSynthesisInput } from "./glitter-context-refresh-synthesis-limit.ts";
import { synthesisPrompt } from "./glitter-context-refresh-synthesis-prompt.ts";
import { GlitterEvidenceError } from "./glitter-context-refresh-evidence-error.ts";

export const RELATIONSHIP_MODEL = "gpt-5.6-luna";
export const RELATIONSHIP_MAX_OUTPUT_TOKENS = 6000;
export const RELATIONSHIP_INPUT_BYTE_LIMIT = 600_000;
const MINIMUM_RELATIONSHIP_EVIDENCE = 2;
const DETERMINISTIC_SEED = 0;

export const RelationshipProposalSchema = z.strictObject({
  sourceId: z.string(),
  targetId: z.string(),
  kind: RelationshipKindSchema,
  label: z.string(),
  direction: RelationshipDirectionSchema,
  effectiveAt: z.iso.date().nullable(),
  evidenceMessageIds: z.array(z.string().regex(/^\d+$/u)).min(2).max(8),
  confidence: z.number().min(0.9).max(1),
  rationale: z.string().min(1).max(500),
});

const RelationshipProposalsSchema = z.strictObject({
  proposals: z.array(RelationshipProposalSchema).max(20),
});

export type RelationshipGenerationInput = {
  people: readonly { id: string; displayName: string }[];
  currentRelationships: readonly RelationshipEvent[];
  evidence: readonly { personId: string; message: CurrentMessage }[];
};

export type ChunkExtractionRepair = {
  previous: StyleChunkSummary;
  error: string;
  rawContent: string | null;
};

export type SynthesisRepair = {
  previous: StyleSynthesis;
  error: string;
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

function relationshipMessages(input: RelationshipGenerationInput) {
  const prompt = [
    "Propose relationship updates only when the supplied Discord messages",
    "contain explicit, high-confidence evidence. Return no proposal when",
    "evidence is ambiguous, joking, hearsay, or merely stylistic.",
    "Each proposal needs 2-8 supplied message IDs. IDs must be copied exactly.",
    "Do not repeat a relationship that is already current.",
    "These proposals will be committed only to a human-reviewed PR.",
    "",
    JSON.stringify({
      people: input.people,
      currentRelationships: input.currentRelationships,
      evidence: input.evidence.map((entry) => ({
        personId: entry.personId,
        ...messageEvidence(entry.message),
      })),
    }),
  ].join("\n");
  return glitterPrompt(
    "You identify explicit relationship changes conservatively and cite corpus evidence.",
    prompt,
  );
}

export function buildBoundedRelationshipInput(
  input: RelationshipGenerationInput,
): {
  evidence: RelationshipGenerationInput["evidence"];
  messages: ReturnType<typeof relationshipMessages>;
  inputBytes: number;
} {
  const minimumEvidence = Math.min(
    MINIMUM_RELATIONSHIP_EVIDENCE,
    input.evidence.length,
  );
  const maximumOmittedEvidence = input.evidence.length - minimumEvidence;
  for (
    let omittedEvidence = 0;
    omittedEvidence <= maximumOmittedEvidence;
    omittedEvidence += 1
  ) {
    const evidence = input.evidence.slice(
      0,
      input.evidence.length - omittedEvidence,
    );
    const messages = relationshipMessages({ ...input, evidence });
    const inputBytes = new TextEncoder().encode(
      JSON.stringify(messages),
    ).length;
    if (inputBytes <= RELATIONSHIP_INPUT_BYTE_LIMIT) {
      return { evidence, messages, inputBytes };
    }
  }
  throw new GlitterEvidenceError(
    `fixed Glitter relationship input exceeds ${String(RELATIONSHIP_INPUT_BYTE_LIMIT)} bytes after reducing evidence to ${String(minimumEvidence)} messages`,
  );
}

export function buildRelationshipGenerationRequest(
  input: RelationshipGenerationInput,
) {
  const bounded = buildBoundedRelationshipInput(input);
  const messages = bounded.messages;
  return {
    model: RELATIONSHIP_MODEL,
    callSite: "glitter-context-relationships",
    messages,
    maxOutputTokens: RELATIONSHIP_MAX_OUTPUT_TOKENS,
    reasoningEffort: "medium" as const,
    seed: DETERMINISTIC_SEED,
    evidence: bounded.evidence,
    inputBytes: bounded.inputBytes,
    responseSchema: glitterObjectArtifactSchema(RelationshipProposalsSchema),
    request: {
      schemaVersion: 3,
      model: RELATIONSHIP_MODEL,
      messages,
      maxCompletionTokens: RELATIONSHIP_MAX_OUTPUT_TOKENS,
      reasoningEffort: "medium",
      seed: DETERMINISTIC_SEED,
      responseSchema: "relationship-proposals-v2",
    },
  };
}

export function styleChunkPrompt(input: {
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

export function buildStyleChunkGenerationRequest(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
  attempt: number;
  repair: ChunkExtractionRepair | null;
}) {
  const basePrompt = styleChunkPrompt(input);
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
  const messages = glitterPrompt(
    "You extract compact, cited style evidence for later synthesis.",
    prompt,
  );
  const seed = DETERMINISTIC_SEED + input.attempt;
  return {
    model: EXTRACTION_MODEL,
    callSite,
    messages,
    maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    semanticRetryMaxOutputTokens: EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    reasoningEffort: "none" as const,
    seed,
    responseSchema: glitterObjectArtifactSchema(StyleChunkSummarySchema),
    request: {
      schemaVersion: 3,
      model: EXTRACTION_MODEL,
      messages,
      maxCompletionTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
      semanticRetryMaxCompletionTokens:
        EXTRACTION_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
      reasoningEffort: "none",
      seed,
      responseSchema: "style-chunk-summary-v2",
    },
  };
}

export function buildStyleSynthesisGenerationRequest(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  chunks: readonly SummarizedChunk[];
  attempt: number;
  repair: SynthesisRepair | null;
}) {
  const bounded = buildBoundedSynthesisInput({
    chunks: input.chunks,
    directRecentMessages: input.candidate.directRecentMessages,
    hasRepairPrevious: input.repair !== null,
    buildMessages: ({ chunks, directRecentMessages, includeRepairPrevious }) =>
      glitterPrompt(
        "You synthesize evidence-grounded writing-style patches for human review.",
        synthesisPrompt({
          ...input,
          chunks,
          directRecentMessages,
          includeRepairPrevious,
        }),
      ),
    serializeMessages: JSON.stringify,
  });
  const callSite =
    input.repair === null
      ? "glitter-style-synthesis"
      : "glitter-style-synthesis-repair";
  const messages = bounded.messages;
  const seed = DETERMINISTIC_SEED + input.attempt;
  return {
    model: SYNTHESIS_MODEL,
    callSite,
    messages,
    maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
    semanticRetryMaxOutputTokens: SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    reasoningEffort: "medium" as const,
    seed,
    chunks: bounded.chunks,
    directRecentMessages: bounded.directRecentMessages,
    includeRepairPrevious: bounded.includeRepairPrevious,
    responseSchema: glitterObjectArtifactSchema(StyleSynthesisSchema),
    request: {
      schemaVersion: 4,
      model: SYNTHESIS_MODEL,
      messages,
      maxCompletionTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
      semanticRetryMaxCompletionTokens:
        SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
      reasoningEffort: "medium",
      seed,
      responseSchema: "style-card-synthesis-v2",
    },
  };
}
