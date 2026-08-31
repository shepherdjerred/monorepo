import { mkdir, rm } from "node:fs/promises";
import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import {
  GenerationStateDocumentSchema,
  PeopleDocumentSchema,
  RelationshipsDocumentSchema,
  StyleCardSchema,
  type GenerationStateDocument,
  type PeopleDocument,
  type RelationshipsDocument,
  type StyleCard,
} from "@shepherdjerred/glitter-context/schema";
import {
  loadVerifiedGlitterCorpus,
  type VerifiedGlitterCorpus,
} from "./glitter-context-refresh-corpus.ts";
import {
  createCorpusGenerationArtifactReader,
  probeGenerationArtifact,
  type GenerationArtifactProbe,
  type GenerationArtifactReader,
} from "./glitter-context-refresh-cache.ts";
import { estimateRelationshipGenerationCost } from "./glitter-context-refresh-generate.ts";
import {
  buildStyleChunkGenerationRequest,
  buildStyleSynthesisGenerationRequest,
  type ChunkExtractionRepair,
  type RelationshipGenerationInput,
} from "./glitter-context-refresh-requests.ts";
import { estimateStyleGenerationCost } from "./glitter-context-refresh-style-generation.ts";
import { SynthesisInputTooLargeError } from "./glitter-context-refresh-synthesis-limit.ts";
import {
  buildStyleEvidenceChunks,
  type StyleEvidenceChunk,
} from "./glitter-context-refresh-chunks.ts";
import { auditRelationshipGenerationCache } from "./glitter-context-audit-relationships.ts";
import { prepareRelationshipEvaluation } from "./glitter-context-refresh-relationship-batching.ts";
import {
  selectStyleRefreshCandidates,
  type StyleRefreshCandidate,
} from "./glitter-context-refresh-selection.ts";
import {
  MAX_EXTRACTION_REPAIR_ATTEMPTS,
  MAX_SYNTHESIS_REPAIR_ATTEMPTS,
  type SummarizedChunk,
} from "./glitter-context-refresh-style-generation-cost.ts";
import { finalizeStyleSynthesis } from "./glitter-context-refresh-style-finalize.ts";
import {
  nextParseFailureRepair,
  selectBestChunkSummary,
  toSummarizedChunk,
  validateChunkSummary,
} from "./glitter-context-refresh-style-validation.ts";
import type {
  StyleChunkSummary,
  StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import {
  GlitterContextAuditInputSchema,
  GlitterContextAuditResultSchema,
  type GlitterContextAuditBlockedStage,
  type GlitterContextAuditInput,
  type GlitterContextAuditResult,
} from "./glitter-context-audit-schema.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const MAIN_BRANCH = "main";
const PACKAGE_PATH = "packages/glitter-context";
type AuditState = {
  cacheHits: number;
  cacheMisses: number;
  artifactKeys: string[];
  blockedStages: GlitterContextAuditBlockedStage[];
};

type AuditInputs = {
  corpus: VerifiedGlitterCorpus;
  peopleDocument: PeopleDocument;
  relationshipsDocument: RelationshipsDocument;
  generationState: GenerationStateDocument;
  existingCards: ReadonlyMap<string, StyleCard>;
  artifactReader: GenerationArtifactReader;
  now: Date;
};

function recordProbe<Response>(
  state: AuditState,
  probe: GenerationArtifactProbe<Response>,
): void {
  state.artifactKeys.push(probe.key);
  if (probe.status === "hit") {
    state.cacheHits += 1;
  } else {
    state.cacheMisses += 1;
  }
}

async function auditChunk(input: {
  candidate: StyleRefreshCandidate;
  chunk: StyleEvidenceChunk;
  artifactReader: GenerationArtifactReader;
  state: AuditState;
}): Promise<StyleChunkSummary | undefined> {
  const attempts: StyleChunkSummary[] = [];
  let repair: ChunkExtractionRepair | null = null;
  for (let attempt = 0; attempt <= MAX_EXTRACTION_REPAIR_ATTEMPTS; attempt++) {
    const request = buildStyleChunkGenerationRequest({
      candidate: input.candidate,
      chunk: input.chunk,
      attempt,
      repair: attempt === 0 ? null : repair,
    });
    const probe = await probeGenerationArtifact({
      store: input.artifactReader,
      model: request.model,
      callSite: request.callSite,
      request: request.request,
      responseSchema: request.responseSchema,
    });
    recordProbe(input.state, probe);
    if (probe.status === "miss") {
      return undefined;
    }
    if (probe.response.outcome === "failure") {
      repair = nextParseFailureRepair(
        repair,
        probe.response.error,
        probe.response.rawContent,
      );
      continue;
    }
    attempts.push(probe.response.value);
    try {
      validateChunkSummary(input.chunk, probe.response.value);
      return probe.response.value;
    } catch (error: unknown) {
      repair = {
        previous: probe.response.value,
        error: z.instanceof(Error).parse(error).message,
        rawContent: null,
      };
    }
  }
  return selectBestChunkSummary(input.chunk, attempts);
}

async function auditSynthesis(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  chunks: readonly SummarizedChunk[];
  sourceSnapshotSha256: string;
  artifactReader: GenerationArtifactReader;
  state: AuditState;
}): Promise<void> {
  let repair: { previous: StyleSynthesis; error: string } | null = null;
  for (let attempt = 0; attempt <= MAX_SYNTHESIS_REPAIR_ATTEMPTS; attempt++) {
    let request: ReturnType<typeof buildStyleSynthesisGenerationRequest>;
    try {
      request = buildStyleSynthesisGenerationRequest({
        candidate: input.candidate,
        existingCard: input.existingCard,
        chunks: input.chunks,
        attempt,
        repair,
      });
    } catch (error: unknown) {
      if (!(error instanceof SynthesisInputTooLargeError)) {
        throw error;
      }
      input.state.blockedStages.push({
        stage: "style-synthesis",
        personId: input.candidate.person.id,
        reason: error.message,
      });
      return;
    }
    const probe = await probeGenerationArtifact({
      store: input.artifactReader,
      model: request.model,
      callSite: request.callSite,
      request: request.request,
      responseSchema: request.responseSchema,
    });
    recordProbe(input.state, probe);
    if (probe.status === "miss") {
      input.state.blockedStages.push({
        stage: "style-synthesis",
        personId: input.candidate.person.id,
        reason: `missing ${probe.key}`,
      });
      return;
    }
    if (probe.response.outcome === "failure") {
      input.state.blockedStages.push({
        stage: "style-synthesis",
        personId: input.candidate.person.id,
        reason: `cached generation failure: ${probe.response.error}`,
      });
      return;
    }
    try {
      finalizeStyleSynthesis({
        candidate: input.candidate,
        existingCard: input.existingCard,
        sourceSnapshotSha256: input.sourceSnapshotSha256,
        chunks: request.chunks,
        directRecentMessages: request.directRecentMessages,
        omittedChunks: input.chunks.length - request.chunks.length,
        omittedSummarizedMessages:
          input.chunks.reduce(
            (total, chunk) => total + chunk.summarizedMessageCount,
            0,
          ) -
          request.chunks.reduce(
            (total, chunk) => total + chunk.summarizedMessageCount,
            0,
          ),
        omittedDirectRecentMessages:
          input.candidate.directRecentMessages.length -
          request.directRecentMessages.length,
        synthesis: probe.response.value,
      });
      return;
    } catch (error: unknown) {
      repair = {
        previous: probe.response.value,
        error: z.instanceof(Error).parse(error).message,
      };
    }
  }
  input.state.blockedStages.push({
    stage: "style-synthesis",
    personId: input.candidate.person.id,
    reason: `cached synthesis exhausted all repairs: ${repair?.error ?? "no deterministic validation error was recorded"}`,
  });
}

async function auditCandidate(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  sourceSnapshotSha256: string;
  artifactReader: GenerationArtifactReader;
  state: AuditState;
}): Promise<void> {
  const summarizedChunks: SummarizedChunk[] = [];
  const missingChunkKeys: string[] = [];
  for (const chunk of buildStyleEvidenceChunks(input.candidate.safeMessages)) {
    const summary = await auditChunk({ ...input, chunk });
    if (summary === undefined) {
      missingChunkKeys.push(chunk.key);
      continue;
    }
    summarizedChunks.push(toSummarizedChunk(chunk, summary));
  }
  if (missingChunkKeys.length > 0) {
    input.state.blockedStages.push({
      stage: "style-synthesis",
      personId: input.candidate.person.id,
      reason: `missing upstream chunk artifacts for ${missingChunkKeys.join(", ")}`,
    });
    return;
  }
  await auditSynthesis({
    ...input,
    chunks: summarizedChunks,
  });
}

export async function auditGlitterContextGenerationCache(
  input: AuditInputs,
): Promise<GlitterContextAuditResult> {
  const candidates = selectStyleRefreshCandidates({
    people: input.peopleDocument.people,
    state: input.generationState.people,
    messages: input.corpus.messages,
    now: input.now,
  });
  const relationshipEvaluation = prepareRelationshipEvaluation({
    state: input.generationState,
    people: input.peopleDocument,
    relationships: input.relationshipsDocument,
    messages: input.corpus.messages,
    snapshotSha256: input.corpus.reference.snapshotSha256,
  });
  const relationshipInput: RelationshipGenerationInput =
    relationshipEvaluation.generationInput;
  const relationshipEvidence = relationshipEvaluation.evidence;
  const state: AuditState = {
    cacheHits: 0,
    cacheMisses: 0,
    artifactKeys: [],
    blockedStages: [],
  };
  let worstCaseUncachedCostUsd = 0;
  for (const candidate of candidates) {
    const existingCard = input.existingCards.get(candidate.person.id);
    if (existingCard === undefined) {
      throw new Error(`missing existing style card for ${candidate.person.id}`);
    }
    worstCaseUncachedCostUsd += estimateStyleGenerationCost({
      candidate,
      existingCard,
    });
    await auditCandidate({
      candidate,
      existingCard,
      sourceSnapshotSha256: input.corpus.reference.snapshotSha256,
      artifactReader: input.artifactReader,
      state,
    });
  }
  worstCaseUncachedCostUsd +=
    estimateRelationshipGenerationCost(relationshipInput);
  if (relationshipInput.evidence.length > 0) {
    const relationshipAudit = await auditRelationshipGenerationCache({
      generationInput: relationshipInput,
      artifactReader: input.artifactReader,
      document: input.relationshipsDocument,
      people: input.peopleDocument.people,
      evidence: relationshipEvidence,
      snapshotSha256: input.corpus.reference.snapshotSha256,
      recordedAt: input.now.toISOString(),
    });
    recordProbe(state, relationshipAudit.probe);
    if (relationshipAudit.blockedReason !== null) {
      state.blockedStages.push({
        stage: "relationships",
        reason: relationshipAudit.blockedReason,
      });
    }
  }
  return GlitterContextAuditResultSchema.parse({
    snapshotId: input.corpus.reference.snapshotId,
    snapshotSha256: input.corpus.reference.snapshotSha256,
    eligiblePeople: candidates.map((candidate) => candidate.person.id),
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    blockedStages: state.blockedStages,
    artifactKeys: state.artifactKeys,
    worstCaseUncachedCostUsd,
  });
}

async function readJson(path: string): Promise<unknown> {
  return await Bun.file(path).json();
}

export const glitterContextAuditActivities = {
  async auditGlitterContext(
    rawInput: GlitterContextAuditInput = {},
  ): Promise<GlitterContextAuditResult> {
    const input = GlitterContextAuditInputSchema.parse(rawInput);
    const execution = Context.current().info.workflowExecution;
    if (execution === undefined) {
      throw new Error("Glitter context audit requires a Temporal execution");
    }
    const tempDir = `/tmp/glitter-context-audit-${execution.runId}`;
    const repoDir = `${tempDir}/monorepo`;
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({ phase: "glitter-context-audit" });
    }, 10_000);
    try {
      const corpus = await loadVerifiedGlitterCorpus(input.snapshot);
      await mkdir(tempDir, { recursive: true });
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--filter=blob:none",
        "--depth=1",
      ]);
      const peopleDocument = PeopleDocumentSchema.parse(
        await readJson(`${repoDir}/${PACKAGE_PATH}/data/people.json`),
      );
      const relationshipsDocument = RelationshipsDocumentSchema.parse(
        await readJson(`${repoDir}/${PACKAGE_PATH}/data/relationships.json`),
      );
      const generationState = GenerationStateDocumentSchema.parse(
        await readJson(`${repoDir}/${PACKAGE_PATH}/data/generation-state.json`),
      );
      const existingCards = new Map<string, StyleCard>();
      const now = new Date(input.now ?? new Date().toISOString());
      const candidates = selectStyleRefreshCandidates({
        people: peopleDocument.people,
        state: generationState.people,
        messages: corpus.messages,
        now,
      });
      for (const candidate of candidates) {
        existingCards.set(
          candidate.person.id,
          StyleCardSchema.parse(
            await readJson(
              `${repoDir}/${PACKAGE_PATH}/data/style-cards/${candidate.person.id}_style.json`,
            ),
          ),
        );
      }
      return await auditGlitterContextGenerationCache({
        corpus,
        peopleDocument,
        relationshipsDocument,
        generationState,
        existingCards,
        artifactReader: createCorpusGenerationArtifactReader(
          createCorpusStoreFromEnv(),
        ),
        now,
      });
    } finally {
      clearInterval(heartbeat);
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
