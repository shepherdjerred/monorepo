import type { S3Client } from "@aws-sdk/client-s3";
import {
  generateFullMatchReview,
  getDefaultStageConfigs,
  type ModelConfig,
  type OpenAIClient,
  type PipelineTraces,
  type PipelineStagesConfig,
} from "@scout-for-lol/data";
import {
  DEFAULT_TIMELINE_AGGREGATE_MODEL,
  DEFAULT_TIMELINE_CHUNK_MODEL,
} from "@scout-for-lol/data/review/pipeline-defaults.ts";

import type { BetaCorpus } from "#materialization/beta-corpus.ts";
import {
  buildCompletedMatch,
  buildDeterministicFacts,
  findRawTarget,
  findTargetPlayerIndex,
} from "#materialization/processed-match.ts";
import {
  loadFrozenPersonality,
  loadLaneContext,
} from "#materialization/prompts.ts";
import { fetchRawMatchPair, sha256 } from "#materialization/s3-source.ts";
import type { MaterializationCaseSpec } from "#materialization/spec.ts";
import type { RecordGenerationInput } from "#server/store.ts";
import {
  CaseArtifactSchema,
  FrozenModelConfigSchema,
  FrozenModelSettingsSchema,
  FrozenRenderedPromptSchema,
  FrozenRenderedPromptsSchema,
  type CaseArtifact,
  type FrozenRenderedPrompts,
} from "#shared/schema.ts";

export type MaterializedCase = {
  artifact: CaseArtifact;
  generation: Omit<RecordGenerationInput, "caseId">;
};

type MaterializedGenerationSource = {
  outputText: string;
  renderedPrompts: FrozenRenderedPrompts;
  trace: PipelineTraces["reviewText"];
};

type MaterializationDependencies = {
  corpus: BetaCorpus;
  openai: OpenAIClient;
  s3: S3Client;
};

function requiredStageText(value: string | undefined, stage: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${stage} did not produce text`);
  }
  return value;
}

function freezeModel(config: ModelConfig) {
  return FrozenModelConfigSchema.parse(config);
}

function freezeRenderedPrompt(
  trace: PipelineTraces["reviewText"],
  stage: string,
) {
  return FrozenRenderedPromptSchema.parse({
    systemPrompt: requiredStageText(
      trace.request.systemPrompt,
      `${stage} system prompt`,
    ),
    userPrompt: requiredStageText(
      trace.request.userPrompt,
      `${stage} user prompt`,
    ),
  });
}

export function freezeRenderedPrompts(
  traces: PipelineTraces,
): FrozenRenderedPrompts {
  if (traces.matchSummary === undefined) {
    throw new Error("Match summary did not produce a trace");
  }
  if (traces.timelineSummary === undefined) {
    throw new Error("Timeline summary did not produce a trace");
  }
  const timeline =
    traces.timelineChunks === undefined
      ? {
          mode: "single",
          summary: freezeRenderedPrompt(
            traces.timelineSummary,
            "Timeline summary",
          ),
        }
      : {
          mode: "chunked",
          chunks: traces.timelineChunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            timeRange: chunk.timeRange,
            ...freezeRenderedPrompt(
              chunk.trace,
              `Timeline chunk ${chunk.chunkIndex.toString()}`,
            ),
          })),
          aggregate: freezeRenderedPrompt(
            traces.timelineSummary,
            "Timeline aggregate",
          ),
        };
  return FrozenRenderedPromptsSchema.parse({
    matchSummary: freezeRenderedPrompt(traces.matchSummary, "Match summary"),
    timeline,
    reviewText: freezeRenderedPrompt(traces.reviewText, "Review text"),
  });
}

export function buildMaterializedGeneration({
  outputText,
  renderedPrompts,
  trace,
}: MaterializedGenerationSource): Omit<RecordGenerationInput, "caseId"> {
  const { systemPrompt, userPrompt } = renderedPrompts.reviewText;
  return {
    durationMs: trace.durationMs,
    inputTokens: trace.tokensPrompt ?? null,
    model: trace.model.model,
    outputText,
    outputTokens: trace.tokensCompletion ?? null,
    promptRevision: sha256(`${systemPrompt}\0${userPrompt}`),
    renderedPrompts,
  };
}

function textOnlyStages(): PipelineStagesConfig {
  const defaults = getDefaultStageConfigs();
  return {
    ...defaults,
    imageDescription: { ...defaults.imageDescription, enabled: false },
    imageGeneration: { ...defaults.imageGeneration, enabled: false },
  };
}

export async function materializeCase(
  dependencies: MaterializationDependencies,
  bucket: string,
  spec: MaterializationCaseSpec,
): Promise<MaterializedCase> {
  const source = await fetchRawMatchPair(
    dependencies.s3,
    bucket,
    spec.matchKey,
    spec.timelineKey,
  );
  const processedMatch = buildCompletedMatch(
    source.rawMatch,
    dependencies.corpus.profilesForMatch(
      source.rawMatch,
      spec.targetPlayerId,
      spec.targetPlayerPuuid,
    ),
  );
  const targetPlayerIndex = findTargetPlayerIndex(
    processedMatch,
    spec.targetPlayerPuuid,
  );
  const targetPlayer = processedMatch.players[targetPlayerIndex];
  if (targetPlayer === undefined)
    throw new Error("Target player index is invalid");
  const rawTarget = findRawTarget(source.rawMatch, spec.targetPlayerPuuid);
  const personality = loadFrozenPersonality(spec);
  const laneContext = loadLaneContext(targetPlayer.lane);
  const stages = textOnlyStages();
  const output = await generateFullMatchReview({
    clients: { openai: dependencies.openai },
    match: {
      processed: processedMatch,
      raw: source.rawMatch,
      rawTimeline: source.rawTimeline,
    },
    player: { index: targetPlayerIndex },
    prompts: {
      laneContext,
      patchNotes: spec.patchContext,
      personality,
      playerHistory: spec.playerHistory,
    },
    stages,
  });
  const renderedPrompts = freezeRenderedPrompts(output.traces);
  const modelSettings = FrozenModelSettingsSchema.parse({
    matchSummary: freezeModel(stages.matchSummary.model),
    reviewText: freezeModel(stages.reviewText.model),
    timelineAggregate: freezeModel(DEFAULT_TIMELINE_AGGREGATE_MODEL),
    timelineChunk: freezeModel(DEFAULT_TIMELINE_CHUNK_MODEL),
    timelineSummary: freezeModel(stages.timelineSummary.model),
  });
  const queueType = processedMatch.queueType;
  if (queueType === undefined)
    throw new Error("Processed match has no queue type");
  const artifact = CaseArtifactSchema.parse({
    championName: targetPlayer.champion.championName,
    context: {
      deterministicFacts: buildDeterministicFacts(source.rawMatch, rawTarget),
      laneContext,
      matchSummary: requiredStageText(
        output.intermediate.matchSummaryText,
        "Match summary",
      ),
      patchContext: spec.patchContext,
      personalityInstructions: personality.instructions,
      playerHistory: spec.playerHistory,
      renderedPrompts,
      selectedBehaviors: spec.selectedBehaviors,
      styleCard: personality.styleCard,
      timelineSummary: requiredStageText(
        output.intermediate.timelineSummaryText,
        "Timeline summary",
      ),
    },
    matchId: source.rawMatch.metadata.matchId,
    modelSettings,
    performanceSlice: spec.performanceSlice,
    processedMatch,
    queueType,
    rawMatch: source.rawMatch,
    rawTimeline: source.rawTimeline,
    schemaVersion: 1,
    source: {
      bucket,
      matchKey: spec.matchKey,
      matchSha256: sha256(source.matchText),
      timelineKey: spec.timelineKey,
      timelineSha256: sha256(source.timelineText),
    },
    styleKey: spec.styleKey,
    targetPlayerIndex,
    targetPlayerName: targetPlayer.playerConfig.alias,
    targetPlayerPuuid: spec.targetPlayerPuuid,
  });
  const trace = output.traces.reviewText;
  return {
    artifact,
    generation: buildMaterializedGeneration({
      outputText: output.review.text,
      renderedPrompts,
      trace,
    }),
  };
}
