import type { S3Client } from "@aws-sdk/client-s3";
import {
  generateFullMatchReview,
  getDefaultStageConfigs,
  type ModelConfig,
  type OpenAIClient,
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
  type CaseArtifact,
} from "#shared/schema.ts";

export type MaterializedCase = {
  artifact: CaseArtifact;
  generation: Omit<RecordGenerationInput, "caseId">;
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
    dependencies.corpus.profilesForMatch(source.rawMatch),
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
  const systemPrompt = requiredStageText(
    output.traces.reviewText.request.systemPrompt,
    "Review system prompt",
  );
  const userPrompt = requiredStageText(
    output.traces.reviewText.request.userPrompt,
    "Review user prompt",
  );
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
      selectedBehaviors: spec.selectedBehaviors,
      styleCard: personality.styleCard,
      systemPrompt,
      timelineSummary: requiredStageText(
        output.intermediate.timelineSummaryText,
        "Timeline summary",
      ),
      userPrompt,
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
    generation: {
      durationMs: trace.durationMs,
      inputTokens: trace.tokensPrompt ?? null,
      model: trace.model.model,
      outputText: output.review.text,
      outputTokens: trace.tokensCompletion ?? null,
      promptRevision: sha256(`${systemPrompt}\0${userPrompt}`),
    },
  };
}
