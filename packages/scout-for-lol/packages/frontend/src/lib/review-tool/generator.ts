/**
 * Review generation logic - UI wrapper over shared data package unified pipeline
 *
 * This is a thin wrapper that:
 * 1. Resolves personality and prompts from UI config
 * 2. Initializes AI clients with user-provided API keys
 * 3. Calls the unified generateFullMatchReview() pipeline
 * 4. Returns results with traces for UI display
 */
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  generateFullMatchReview,
  type ArenaMatch,
  type CompletedMatch,
  type RawMatch,
  type RawTimeline,
  type ReviewPipelineOutput,
  type PipelineStagesConfig,
  selectRandomStyle,
  TIMELINE_SUMMARY_SYSTEM_PROMPT,
  TIMELINE_SUMMARY_USER_PROMPT,
  MATCH_SUMMARY_SYSTEM_PROMPT,
  MATCH_SUMMARY_USER_PROMPT,
  REVIEW_TEXT_SYSTEM_PROMPT,
  REVIEW_TEXT_USER_PROMPT,
  IMAGE_DESCRIPTION_SYSTEM_PROMPT,
  IMAGE_DESCRIPTION_USER_PROMPT,
  IMAGE_GENERATION_USER_PROMPT,
} from "@scout-for-lol/data";
import type {
  ReviewConfig,
  GenerationResult,
  GenerationMetadata,
  Personality,
} from "./config/schema.ts";
import { createDefaultPipelineStages } from "./config/schema.ts";
import {
  selectRandomPersonality,
  getPersonalityById,
  getLaneContext,
} from "./prompts.ts";
import { convertStagesToDataPackageFormat } from "./stages-converter.ts";

export type GenerationStep =
  | "timeline-summary"
  | "timeline-chunk"
  | "timeline-aggregate"
  | "match-summary"
  | "review-text"
  | "image-description"
  | "image-generation"
  | "complete";

export type GenerationProgress = {
  step: GenerationStep;
  message: string;
  /** Current stage number (1-based) */
  currentStage?: number;
  /** Total number of enabled stages */
  totalStages?: number;
  /** For chunked stages: current chunk index (1-based) */
  chunkIndex?: number;
  /** For chunked stages: total number of chunks */
  chunkTotal?: number;
};

/**
 * Resolve personality from config
 */
function resolvePersonality(config: ReviewConfig): Personality {
  if (config.prompts.customPersonality) {
    return config.prompts.customPersonality;
  }
  if (config.prompts.personalityId === "random") {
    return selectRandomPersonality();
  }
  const found = getPersonalityById(config.prompts.personalityId);
  if (!found) {
    throw new Error(`Personality not found: ${config.prompts.personalityId}`);
  }
  return found;
}

/**
 * Get pipeline stages config from ReviewConfig
 * Falls back to default if not provided
 */
function getStagesConfig(config: ReviewConfig): PipelineStagesConfig {
  if (config.stages) {
    return convertStagesToDataPackageFormat(config.stages);
  }

  // Fall back to defaults, but override with legacy textGeneration/imageGeneration settings
  const defaults = createDefaultPipelineStages();

  // Build review text model config carefully for exactOptionalPropertyTypes
  const reviewTextModel: PipelineStagesConfig["reviewText"]["model"] = {
    model: config.textGeneration.model,
    maxTokens: config.textGeneration.maxTokens,
    temperature: config.textGeneration.temperature,
    topP: config.textGeneration.topP,
  };

  // Build the result object piece by piece to handle exactOptionalPropertyTypes correctly
  const result: PipelineStagesConfig = {
    timelineSummary: {
      enabled: defaults.timelineSummary.enabled,
      model: {
        model: defaults.timelineSummary.model.model,
        maxTokens: defaults.timelineSummary.model.maxTokens,
      },
      systemPrompt:
        defaults.timelineSummary.systemPrompt ?? TIMELINE_SUMMARY_SYSTEM_PROMPT,
      userPrompt:
        defaults.timelineSummary.userPrompt ?? TIMELINE_SUMMARY_USER_PROMPT,
    },
    matchSummary: {
      enabled: defaults.matchSummary.enabled,
      model: {
        model: defaults.matchSummary.model.model,
        maxTokens: defaults.matchSummary.model.maxTokens,
      },
      systemPrompt:
        defaults.matchSummary.systemPrompt ?? MATCH_SUMMARY_SYSTEM_PROMPT,
      userPrompt: defaults.matchSummary.userPrompt ?? MATCH_SUMMARY_USER_PROMPT,
    },
    reviewText: {
      model: reviewTextModel,
      systemPrompt:
        defaults.reviewText.systemPrompt ?? REVIEW_TEXT_SYSTEM_PROMPT,
      userPrompt: defaults.reviewText.userPrompt ?? REVIEW_TEXT_USER_PROMPT,
    },
    imageDescription: {
      enabled: defaults.imageDescription.enabled,
      model: {
        model: defaults.imageDescription.model.model,
        maxTokens: defaults.imageDescription.model.maxTokens,
      },
      systemPrompt:
        defaults.imageDescription.systemPrompt ??
        IMAGE_DESCRIPTION_SYSTEM_PROMPT,
      userPrompt:
        defaults.imageDescription.userPrompt ?? IMAGE_DESCRIPTION_USER_PROMPT,
    },
    imageGeneration: {
      enabled: config.imageGeneration.enabled,
      model: config.imageGeneration.model,
      timeoutMs: config.imageGeneration.timeoutMs,
      artStyle: selectRandomStyle(),
      userPrompt:
        defaults.imageGeneration.userPrompt ?? IMAGE_GENERATION_USER_PROMPT,
    },
  };

  // Add optional model properties
  if (defaults.timelineSummary.model.temperature !== undefined) {
    result.timelineSummary.model.temperature =
      defaults.timelineSummary.model.temperature;
  }
  if (defaults.timelineSummary.model.topP !== undefined) {
    result.timelineSummary.model.topP = defaults.timelineSummary.model.topP;
  }

  if (defaults.matchSummary.model.temperature !== undefined) {
    result.matchSummary.model.temperature =
      defaults.matchSummary.model.temperature;
  }
  if (defaults.matchSummary.model.topP !== undefined) {
    result.matchSummary.model.topP = defaults.matchSummary.model.topP;
  }

  if (defaults.imageDescription.model.temperature !== undefined) {
    result.imageDescription.model.temperature =
      defaults.imageDescription.model.temperature;
  }
  if (defaults.imageDescription.model.topP !== undefined) {
    result.imageDescription.model.topP = defaults.imageDescription.model.topP;
  }

  return result;
}

/**
 * Build generation metadata from pipeline output
 */
function buildGenerationMetadata(
  pipelineOutput: ReviewPipelineOutput,
): GenerationMetadata {
  const { traces, intermediate, context } = pipelineOutput;

  // Calculate total image duration if image was generated
  let imageDurationMs: number | undefined;
  if (traces.imageDescription) {
    imageDurationMs = traces.imageDescription.durationMs;
  }
  if (traces.imageGeneration) {
    imageDurationMs =
      (imageDurationMs ?? 0) + traces.imageGeneration.durationMs;
  }

  return {
    // Legacy fields for backward compatibility
    textTokensPrompt: traces.reviewText.tokensPrompt,
    textTokensCompletion: traces.reviewText.tokensCompletion,
    textDurationMs: traces.reviewText.durationMs,
    imageDurationMs,
    imageGenerated: pipelineOutput.review.imageBase64 !== undefined,
    selectedPersonality: context.personality.name,
    reviewerName: context.reviewerName,
    systemPrompt: traces.reviewText.request.systemPrompt,
    userPrompt: traces.reviewText.request.userPrompt,
    geminiPrompt: traces.imageGeneration?.request.prompt,
    geminiModel: traces.imageGeneration?.model,
    imageDescription: intermediate.imageDescriptionText,
    // New pipeline fields
    traces,
    intermediate,
    context,
  };
}

/**
 * Parameters for generating a match review
 */
export type GenerateMatchReviewParams = {
  match: CompletedMatch | ArenaMatch;
  config: ReviewConfig;
  onProgress?: (progress: GenerationProgress) => void;
  /** Raw match data from Riot API (required for match summary generation) */
  rawMatch: RawMatch;
  /** Raw timeline data from Riot API (required for timeline summary) */
  rawTimeline: RawTimeline;
};

/**
 * Build the list of enabled pipeline stages for progress tracking
 */
function buildEnabledStagesList(
  stages: PipelineStagesConfig,
  hasGeminiClient: boolean,
): GenerationStep[] {
  const enabledStages: GenerationStep[] = [];
  if (stages.timelineSummary.enabled) {
    enabledStages.push("timeline-summary");
  }
  if (stages.matchSummary.enabled) {
    enabledStages.push("match-summary");
  }
  enabledStages.push("review-text"); // Always enabled
  if (stages.imageDescription.enabled) {
    enabledStages.push("image-description");
  }
  if (stages.imageGeneration.enabled && hasGeminiClient) {
    enabledStages.push("image-generation");
  }
  return enabledStages;
}

/**
 * Generate a complete match review using the unified pipeline
 */
export async function generateMatchReview(
  params: GenerateMatchReviewParams,
): Promise<GenerationResult> {
  const { match, config, onProgress, rawMatch, rawTimeline } = params;
  const startTime = Date.now();

  try {
    // Validate OpenAI API key
    if (config.api.openaiApiKey === undefined) {
      throw new Error("OpenAI API key is required");
    }

    // Get personality from config
    const personality = resolvePersonality(config);
    if (!personality.styleCard || personality.styleCard.trim().length === 0) {
      throw new Error(
        `Style card missing for personality "${personality.id}". Add a corresponding file under packages/analysis/llm-out/<name>_style.json and wire it into the personality loader.`,
      );
    }

    // Get prompt context
    const player = match.players[0];
    const lane =
      match.queueType === "arena"
        ? undefined
        : player && "lane" in player
          ? player.lane
          : undefined;
    const laneContext = config.prompts.laneContext ?? getLaneContext(lane);

    // Initialize OpenAI client
    const openaiClient = new OpenAI({
      apiKey: config.api.openaiApiKey,
      dangerouslyAllowBrowser: true,
    });

    // Initialize Gemini client if API key provided
    let geminiClient: GoogleGenerativeAI | undefined;
    if (
      config.api.geminiApiKey !== undefined &&
      config.api.geminiApiKey.length > 0
    ) {
      geminiClient = new GoogleGenerativeAI(config.api.geminiApiKey);
    }

    // Get stage configs
    const stages = getStagesConfig(config);

    // Build match input - raw and rawTimeline are required for summaries
    const matchInput: Parameters<typeof generateFullMatchReview>[0]["match"] = {
      processed: match,
      raw: rawMatch,
      rawTimeline,
    };

    // Build clients input
    const clientsInput: Parameters<
      typeof generateFullMatchReview
    >[0]["clients"] = {
      openai: openaiClient,
    };
    if (geminiClient !== undefined) {
      clientsInput.gemini = geminiClient;
    }

    // Build prompts input
    const promptsInput: Parameters<
      typeof generateFullMatchReview
    >[0]["prompts"] = {
      personality,
      laneContext,
    };

    // Count enabled stages for completion tracking
    const enabledStages = buildEnabledStagesList(
      stages,
      geminiClient !== undefined,
    );

    // Build pipeline input, conditionally including onProgress to satisfy exactOptionalPropertyTypes
    const pipelineInput: Parameters<typeof generateFullMatchReview>[0] = {
      match: matchInput,
      player: {
        index: 0, // Always review first player in frontend
      },
      prompts: promptsInput,
      clients: clientsInput,
      stages,
    };

    // Add progress callback if provided
    if (onProgress) {
      pipelineInput.onProgress = (p) => {
        const progress: GenerationProgress = {
          step: p.stage,
          message: p.message,
          currentStage: p.currentStage,
          totalStages: p.totalStages,
        };
        if (p.chunkIndex !== undefined) {
          progress.chunkIndex = p.chunkIndex;
        }
        if (p.chunkTotal !== undefined) {
          progress.chunkTotal = p.chunkTotal;
        }
        onProgress(progress);
      };
    }

    // Call unified pipeline
    const pipelineOutput = await generateFullMatchReview(pipelineInput);

    onProgress?.({
      step: "complete",
      message: "Complete!",
      currentStage: enabledStages.length,
      totalStages: enabledStages.length,
    });

    // Build metadata
    const metadata = buildGenerationMetadata(pipelineOutput);

    // Return result
    const result: GenerationResult = {
      text: pipelineOutput.review.text,
      metadata,
    };

    if (pipelineOutput.review.imageBase64 !== undefined) {
      result.image = pipelineOutput.review.imageBase64;
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      text: "",
      metadata: {
        textDurationMs: Date.now() - startTime,
        imageGenerated: false,
      },
      error: errorMessage,
    };
  }
}
