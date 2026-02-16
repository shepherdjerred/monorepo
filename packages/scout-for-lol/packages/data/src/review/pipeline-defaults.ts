/**
 * Default configurations and system prompts for the unified AI review pipeline
 *
 * This module contains all the default values that can be overridden by callers.
 */

import type {
  PipelineStagesConfig,
  ModelConfig,
  StageConfig,
  ImageGenerationStageConfig,
  ReviewTextStageConfig,
} from "./pipeline-types.ts";
import { selectRandomStyle } from "@scout-for-lol/data/review/art-styles.ts";

// Import system prompts from TXT files (using ?raw for Vite to return content, not URL)
import TIMELINE_SUMMARY_SYSTEM_PROMPT_RAW from "./prompts/system/1b-timeline-summary.txt?raw";
import TIMELINE_CHUNK_SYSTEM_PROMPT_RAW from "./prompts/system/1c-timeline-chunk.txt?raw";
import TIMELINE_AGGREGATE_SYSTEM_PROMPT_RAW from "./prompts/system/1d-timeline-aggregate.txt?raw";
import MATCH_SUMMARY_SYSTEM_PROMPT_RAW from "./prompts/system/1a-match-summary.txt?raw";
import REVIEW_TEXT_SYSTEM_PROMPT_RAW from "./prompts/system/2-review-text.txt?raw";
import IMAGE_DESCRIPTION_SYSTEM_PROMPT_RAW from "./prompts/system/3-image-description.txt?raw";

// Import user prompts from TXT files (using ?raw for Vite to return content, not URL)
import TIMELINE_SUMMARY_USER_PROMPT_RAW from "./prompts/user/1b-timeline-summary.txt?raw";
import TIMELINE_CHUNK_USER_PROMPT_RAW from "./prompts/user/1c-timeline-chunk.txt?raw";
import TIMELINE_AGGREGATE_USER_PROMPT_RAW from "./prompts/user/1d-timeline-aggregate.txt?raw";
import MATCH_SUMMARY_USER_PROMPT_RAW from "./prompts/user/1a-match-summary.txt?raw";
import REVIEW_TEXT_USER_PROMPT_RAW from "./prompts/user/2-review-text.txt?raw";
import IMAGE_DESCRIPTION_USER_PROMPT_RAW from "./prompts/user/3-image-description.txt?raw";
import IMAGE_GENERATION_USER_PROMPT_RAW from "./prompts/user/4-image-generation.txt?raw";

// ============================================================================
// System Prompts
// ============================================================================

/**
 * System prompt for Stage 1a: Timeline Summary (legacy, full timeline)
 *
 * Summarizes curated timeline data (kills, objectives, towers, gold snapshots)
 * into a concise narrative of how the game unfolded.
 */
export const TIMELINE_SUMMARY_SYSTEM_PROMPT = TIMELINE_SUMMARY_SYSTEM_PROMPT_RAW.trim();

/**
 * System prompt for Stage 1a (Chunked): Timeline Chunk Summary
 *
 * Summarizes a single chunk of timeline data (typically 10 minutes).
 * Each chunk is processed independently, then aggregated.
 */
export const TIMELINE_CHUNK_SYSTEM_PROMPT = TIMELINE_CHUNK_SYSTEM_PROMPT_RAW.trim();

/**
 * System prompt for Stage 1a (Aggregation): Timeline Aggregate
 *
 * Combines multiple chunk summaries into a cohesive narrative.
 * Identifies cross-chunk patterns and game flow.
 */
export const TIMELINE_AGGREGATE_SYSTEM_PROMPT = TIMELINE_AGGREGATE_SYSTEM_PROMPT_RAW.trim();

/**
 * System prompt for Stage 1b: Match Summary
 *
 * Summarizes match data for a single player's performance.
 * Output is factual and will be used by the personality reviewer.
 */
// TODO: include the lane context in the system prompt
export const MATCH_SUMMARY_SYSTEM_PROMPT = MATCH_SUMMARY_SYSTEM_PROMPT_RAW.trim();

/**
 * System prompt for Stage 2: Review Text
 *
 * Uses the personality instructions, style card, and lane context
 * to guide the review generation.
 */
export const REVIEW_TEXT_SYSTEM_PROMPT = REVIEW_TEXT_SYSTEM_PROMPT_RAW.trim();

/**
 * System prompt for Stage 3: Image Description
 *
 * Turns a review into a vivid image concept for Gemini to generate.
 */
export const IMAGE_DESCRIPTION_SYSTEM_PROMPT = IMAGE_DESCRIPTION_SYSTEM_PROMPT_RAW.trim();

// ============================================================================
// User Prompts (Templates with variables)
// See prompt-variables.ts for variable documentation
// ============================================================================

export const TIMELINE_SUMMARY_USER_PROMPT = TIMELINE_SUMMARY_USER_PROMPT_RAW.trim();
export const TIMELINE_CHUNK_USER_PROMPT = TIMELINE_CHUNK_USER_PROMPT_RAW.trim();
export const TIMELINE_AGGREGATE_USER_PROMPT = TIMELINE_AGGREGATE_USER_PROMPT_RAW.trim();
export const MATCH_SUMMARY_USER_PROMPT = MATCH_SUMMARY_USER_PROMPT_RAW.trim();
export const REVIEW_TEXT_USER_PROMPT = REVIEW_TEXT_USER_PROMPT_RAW.trim();
export const IMAGE_DESCRIPTION_USER_PROMPT = IMAGE_DESCRIPTION_USER_PROMPT_RAW.trim();
export const IMAGE_GENERATION_USER_PROMPT = IMAGE_GENERATION_USER_PROMPT_RAW.trim();

// ============================================================================
// Default Model Configurations
// ============================================================================

/**
 * Default model config for timeline summary (Stage 1a - legacy full timeline)
 *
 * Uses gpt-5-mini (200k context) which handles large timeline data well.
 * The full raw timeline from Riot API can be 100k+ tokens (one frame per minute with
 * 10 participants' detailed stats + hundreds of events).
 */
export const DEFAULT_TIMELINE_SUMMARY_MODEL: ModelConfig = {
  model: "gpt-5-mini",
  maxTokens: 6000,
  temperature: 0.3,
};

/**
 * Default model config for timeline chunk summary (Stage 1a - chunked)
 *
 * Uses gpt-5-mini for each 10-minute chunk. The raw timeline data can be
 * very large for action-packed games (50+ stats per player per frame,
 * detailed event data), so we set a higher maxTokens to ensure output
 * generation doesn't fail due to context limits.
 */
export const DEFAULT_TIMELINE_CHUNK_MODEL: ModelConfig = {
  model: "gpt-5-mini",
  maxTokens: 32000,
  temperature: 0.3,
};

/**
 * Default model config for timeline aggregation (Stage 1a - aggregation)
 *
 * Uses gpt-5-mini to combine chunk summaries into a cohesive narrative.
 * Input is just text summaries (~500-1000 tokens per chunk).
 */
export const DEFAULT_TIMELINE_AGGREGATE_MODEL: ModelConfig = {
  model: "gpt-5-mini",
  maxTokens: 4000,
  temperature: 0.3,
};

/**
 * Default model config for match summary (Stage 1b)
 *
 * Uses gpt-5-mini (200k context) which handles large match data well.
 * The full raw match from Riot API can be 100k+ tokens (10 players × 150+ fields each,
 * including challenges, perks, missions).
 */
export const DEFAULT_MATCH_SUMMARY_MODEL: ModelConfig = {
  model: "gpt-5-mini",
  maxTokens: 6000,
  temperature: 0.4,
};

/**
 * Default model config for review text (Stage 2)
 */
export const DEFAULT_REVIEW_TEXT_MODEL: ModelConfig = {
  model: "gpt-5.1",
  maxTokens: 3000,
};

/**
 * Default model config for image description (Stage 3)
 */
export const DEFAULT_IMAGE_DESCRIPTION_MODEL: ModelConfig = {
  model: "gpt-5.1",
  maxTokens: 1800,
  temperature: 0.8,
};

/**
 * Default model for image generation (Stage 4)
 */
export const DEFAULT_IMAGE_GENERATION_MODEL = "gemini-3-pro-image-preview";

/**
 * Default timeout for image generation (Stage 4)
 */
export const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 60_000;

// ============================================================================
// Default Stage Configurations
// ============================================================================

/**
 * Default configuration for timeline summary stage
 */
const DEFAULT_TIMELINE_SUMMARY_STAGE: StageConfig = {
  enabled: true,
  model: DEFAULT_TIMELINE_SUMMARY_MODEL,
  systemPrompt: TIMELINE_SUMMARY_SYSTEM_PROMPT,
  userPrompt: TIMELINE_SUMMARY_USER_PROMPT,
};

/**
 * Default configuration for match summary stage
 */
const DEFAULT_MATCH_SUMMARY_STAGE: StageConfig = {
  enabled: true,
  model: DEFAULT_MATCH_SUMMARY_MODEL,
  systemPrompt: MATCH_SUMMARY_SYSTEM_PROMPT,
  userPrompt: MATCH_SUMMARY_USER_PROMPT,
};

/**
 * Default configuration for image description stage
 */
const DEFAULT_IMAGE_DESCRIPTION_STAGE: StageConfig = {
  enabled: true,
  model: DEFAULT_IMAGE_DESCRIPTION_MODEL,
  systemPrompt: IMAGE_DESCRIPTION_SYSTEM_PROMPT,
  userPrompt: IMAGE_DESCRIPTION_USER_PROMPT,
};

/**
 * Default configuration for review text stage
 */
const DEFAULT_REVIEW_TEXT_STAGE: ReviewTextStageConfig = {
  model: DEFAULT_REVIEW_TEXT_MODEL,
  systemPrompt: REVIEW_TEXT_SYSTEM_PROMPT,
  userPrompt: REVIEW_TEXT_USER_PROMPT,
};

/**
 * Create default configuration for image generation stage
 * Selects a random art style for each call
 */
function createDefaultImageGenerationStage(): ImageGenerationStageConfig {
  return {
    enabled: true,
    model: DEFAULT_IMAGE_GENERATION_MODEL,
    timeoutMs: DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
    artStyle: selectRandomStyle(),
    userPrompt: IMAGE_GENERATION_USER_PROMPT,
  };
}

/**
 * Create complete default stage configurations
 *
 * Returns a new config each time to ensure fresh random art style selection.
 * Use this instead of a constant to get proper per-generation randomization.
 */
export function getDefaultStageConfigs(): PipelineStagesConfig {
  return {
    timelineSummary: DEFAULT_TIMELINE_SUMMARY_STAGE,
    matchSummary: DEFAULT_MATCH_SUMMARY_STAGE,
    reviewText: DEFAULT_REVIEW_TEXT_STAGE,
    imageDescription: DEFAULT_IMAGE_DESCRIPTION_STAGE,
    imageGeneration: createDefaultImageGenerationStage(),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create stage configs with custom overrides
 *
 * Merges custom overrides with defaults, allowing partial overrides.
 * Selects a fresh random art style if not provided in overrides.
 */
export function createStageConfigs(overrides?: Partial<PipelineStagesConfig>): PipelineStagesConfig {
  const defaultImageGeneration = createDefaultImageGenerationStage();

  if (!overrides) {
    return {
      timelineSummary: DEFAULT_TIMELINE_SUMMARY_STAGE,
      matchSummary: DEFAULT_MATCH_SUMMARY_STAGE,
      reviewText: DEFAULT_REVIEW_TEXT_STAGE,
      imageDescription: DEFAULT_IMAGE_DESCRIPTION_STAGE,
      imageGeneration: defaultImageGeneration,
    };
  }

  return {
    timelineSummary: {
      ...DEFAULT_TIMELINE_SUMMARY_STAGE,
      ...overrides.timelineSummary,
      model: {
        ...DEFAULT_TIMELINE_SUMMARY_MODEL,
        ...overrides.timelineSummary?.model,
      },
    },
    matchSummary: {
      ...DEFAULT_MATCH_SUMMARY_STAGE,
      ...overrides.matchSummary,
      model: {
        ...DEFAULT_MATCH_SUMMARY_MODEL,
        ...overrides.matchSummary?.model,
      },
    },
    reviewText: {
      ...DEFAULT_REVIEW_TEXT_STAGE,
      ...overrides.reviewText,
      model: {
        ...DEFAULT_REVIEW_TEXT_MODEL,
        ...overrides.reviewText?.model,
      },
    },
    imageDescription: {
      ...DEFAULT_IMAGE_DESCRIPTION_STAGE,
      ...overrides.imageDescription,
      model: {
        ...DEFAULT_IMAGE_DESCRIPTION_MODEL,
        ...overrides.imageDescription?.model,
      },
    },
    imageGeneration: {
      ...defaultImageGeneration,
      ...overrides.imageGeneration,
    },
  };
}
