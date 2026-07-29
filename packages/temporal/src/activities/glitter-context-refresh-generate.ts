import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod/v4";
import {
  RelationshipDirectionSchema,
  RelationshipKindSchema,
  type RelationshipEvent,
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
  glitterChatMessages,
  glitterCompletionUsage,
  parseGlitterCompletion,
} from "./glitter-context-refresh-openai.ts";

const RELATIONSHIP_MODEL = "gpt-5.6-sol";
const RELATIONSHIP_MAX_OUTPUT_TOKENS = 6000;
const DETERMINISTIC_SEED = 0;

const RelationshipProposalSchema = z.strictObject({
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

export type RelationshipProposal = z.infer<typeof RelationshipProposalSchema>;

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

type RelationshipGenerationInput = {
  people: readonly { id: string; displayName: string }[];
  currentRelationships: readonly RelationshipEvent[];
  evidence: readonly {
    personId: string;
    message: CurrentMessage;
  }[];
};

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
  return glitterChatMessages(
    "You identify explicit relationship changes conservatively and cite corpus evidence.",
    prompt,
  );
}

export function estimateRelationshipGenerationCost(
  input: RelationshipGenerationInput,
): number {
  if (input.evidence.length === 0) {
    return 0;
  }
  return estimatedCallCostUsd({
    model: RELATIONSHIP_MODEL,
    inputTokenUpperBound: inputTokenUpperBound(
      JSON.stringify(relationshipMessages(input)),
    ),
    outputTokenUpperBound: RELATIONSHIP_MAX_OUTPUT_TOKENS,
  });
}

export async function proposeRelationships(input: {
  people: readonly { id: string; displayName: string }[];
  currentRelationships: readonly RelationshipEvent[];
  evidence: readonly {
    personId: string;
    message: CurrentMessage;
  }[];
  artifactStore: GenerationArtifactStore;
  budget: GenerationBudget;
}): Promise<RelationshipProposal[]> {
  if (input.evidence.length === 0) {
    return [];
  }
  const callSite = "glitter-context-relationships";
  const messages = relationshipMessages(input);
  const params = {
    model: RELATIONSHIP_MODEL,
    messages,
    max_completion_tokens: RELATIONSHIP_MAX_OUTPUT_TOKENS,
    reasoning_effort: "medium" as const,
    seed: DETERMINISTIC_SEED,
    response_format: zodResponseFormat(
      RelationshipProposalsSchema,
      "relationship_proposals",
    ),
  };
  const artifact = await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: RELATIONSHIP_MODEL,
    callSite,
    request: {
      schemaVersion: 2,
      model: RELATIONSHIP_MODEL,
      messages,
      maxCompletionTokens: params.max_completion_tokens,
      reasoningEffort: params.reasoning_effort,
      seed: params.seed,
      responseSchema: "relationship-proposals-v2",
    },
    responseSchema: RelationshipProposalsSchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        estimatedCallCostUsd({
          model: RELATIONSHIP_MODEL,
          inputTokenUpperBound: inputTokenUpperBound(JSON.stringify(params)),
          outputTokenUpperBound: RELATIONSHIP_MAX_OUTPUT_TOKENS,
        }),
      );
      const completion = await parseGlitterCompletion(callSite, params);
      const parsed = completion.choices[0]?.message.parsed;
      if (parsed === null || parsed === undefined) {
        throw new Error(
          "GPT-5.6 Sol did not return parsed relationship proposals",
        );
      }
      return {
        response: parsed,
        usage: glitterCompletionUsage({
          model: RELATIONSHIP_MODEL,
          usage: completion.usage,
        }),
      };
    },
  });
  input.budget.record(artifact);
  return artifact.response.proposals;
}
