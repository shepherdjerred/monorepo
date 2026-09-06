import { z } from "zod/v4";
import { type RelationshipEvent } from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import {
  type GenerationBudget,
  worstCaseGenerationCostUsd,
} from "./glitter-context-refresh-budget.ts";
import {
  readOrCreateGenerationArtifact,
  type GenerationArtifactStore,
} from "./glitter-context-refresh-cache.ts";
import {
  generateGlitterObject,
  useGlitterObjectArtifact,
} from "./glitter-context-refresh-llm.ts";
import {
  buildRelationshipGenerationRequest,
  RelationshipProposalSchema,
  type RelationshipGenerationInput,
} from "./glitter-context-refresh-requests.ts";

export type RelationshipProposal = z.infer<typeof RelationshipProposalSchema>;

export function estimateRelationshipGenerationCost(
  input: RelationshipGenerationInput,
): number {
  if (input.evidence.length === 0) {
    return 0;
  }
  const generationRequest = buildRelationshipGenerationRequest(input);
  return worstCaseGenerationCostUsd({
    model: generationRequest.model,
    inputTokenUpperBound: generationRequest.inputBytes,
    outputTokenUpperBound: generationRequest.maxOutputTokens,
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
  const generationRequest = buildRelationshipGenerationRequest(input);
  const artifact = await readOrCreateGenerationArtifact({
    store: input.artifactStore,
    model: generationRequest.model,
    callSite: generationRequest.callSite,
    request: generationRequest.request,
    responseSchema: generationRequest.responseSchema,
    generate: async () => {
      input.budget.authorizeUncachedCall(
        worstCaseGenerationCostUsd({
          model: generationRequest.model,
          inputTokenUpperBound: generationRequest.inputBytes,
          outputTokenUpperBound: generationRequest.maxOutputTokens,
        }),
      );
      return await generateGlitterObject({
        model: generationRequest.model,
        schema: z.strictObject({
          proposals: z.array(RelationshipProposalSchema).max(20),
        }),
        schemaName: "relationship_proposals",
        ...generationRequest.messages,
        workload: generationRequest.callSite,
        maxOutputTokens: generationRequest.maxOutputTokens,
        reasoningEffort: generationRequest.reasoningEffort,
        seed: generationRequest.seed,
        exhaustionError:
          "GPT-5.6 Luna did not return parsed relationship proposals",
      });
    },
  });
  return useGlitterObjectArtifact({
    artifact,
    budget: input.budget,
  }).proposals;
}
