import { z } from "zod/v4";
import type {
  Person,
  RelationshipsDocument,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import {
  probeGenerationArtifact,
  type GenerationArtifactReader,
} from "./glitter-context-refresh-cache.ts";
import {
  buildRelationshipGenerationRequest,
  type RelationshipGenerationInput,
} from "./glitter-context-refresh-requests.ts";
import { applyRelationshipProposals } from "./glitter-context-refresh-relationships.ts";

export async function auditRelationshipGenerationCache(input: {
  generationInput: RelationshipGenerationInput;
  artifactReader: GenerationArtifactReader;
  document: RelationshipsDocument;
  people: readonly Person[];
  evidence: readonly { personId: string; message: CurrentMessage }[];
  snapshotSha256: string;
  recordedAt: string;
}) {
  const request = buildRelationshipGenerationRequest(input.generationInput);
  const probe = await probeGenerationArtifact({
    store: input.artifactReader,
    model: request.model,
    callSite: request.callSite,
    request: request.request,
    responseSchema: request.responseSchema,
  });
  if (probe.status === "miss") {
    return { probe, blockedReason: `missing ${probe.key}` };
  }
  if (probe.response.outcome === "failure") {
    return {
      probe,
      blockedReason: `cached generation failure: ${probe.response.error}`,
    };
  }
  try {
    applyRelationshipProposals({
      document: input.document,
      proposals: probe.response.value.proposals,
      people: input.people,
      evidence: input.evidence,
      snapshotSha256: input.snapshotSha256,
      recordedAt: input.recordedAt,
    });
    return { probe, blockedReason: null };
  } catch (error: unknown) {
    return {
      probe,
      blockedReason: `cached proposal validation failed: ${z.instanceof(Error).parse(error).message}`,
    };
  }
}
