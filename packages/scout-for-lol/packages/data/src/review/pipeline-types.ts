/**
 * Type definitions for the unified AI review pipeline
 *
 * This module defines all types for the review generation pipeline that is shared
 * between the backend and frontend dev tool. The pipeline is designed to be:
 * - Platform-agnostic (no filesystem, S3, or Sentry dependencies)
 * - Fully configurable per-stage
 * - Observable with full trace output
 */

import type { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  ArenaMatch,
  CompletedMatch,
} from "@scout-for-lol/data/model/index";
import type { RawMatch } from "@scout-for-lol/data/league/raw-match.schema";
import type { RawTimeline } from "@scout-for-lol/data/league/raw-timeline.schema";
import type { Personality } from "./prompts.ts";
import type { ArtStyle } from "@scout-for-lol/data/review/art-categories";

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Configuration for an AI model call
 */
export type ModelConfig = {
  model: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
};

/**
 * Configuration for a pipeline stage that can be enabled/disabled
 */
export type StageConfig = {
  enabled: boolean;
  model: ModelConfig;
  /** System prompt for this stage */
  systemPrompt: string;
  /** User prompt template for this stage (with variable placeholders) */
  userPrompt: string;
};

/**
 * Configuration for the review text stage (always enabled)
 */
export type ReviewTextStageConfig = {
  model: ModelConfig;
  /** System prompt for this stage */
  systemPrompt: string;
  /** User prompt template for this stage (with variable placeholders) */
  userPrompt: string;
};

/**
 * Configuration for image generation stage
 */
export type ImageGenerationStageConfig = {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  /** Art style to apply to the generated image */
  artStyle: ArtStyle;
  /** User prompt template for image generation (with variable placeholders) */
  userPrompt: string;
};

/**
 * All pipeline stage configurations
 */
export type PipelineStagesConfig = {
  /** Stage 1a: Summarize timeline JSON to text */
  timelineSummary: StageConfig;
  /** Stage 1b: Summarize match JSON to text */
  matchSummary: StageConfig;
  /** Stage 2: Generate review text using personality */
  reviewText: ReviewTextStageConfig;
  /** Stage 3: Generate image description from review */
  imageDescription: StageConfig;
  /** Stage 4: Generate image from description */
  imageGeneration: ImageGenerationStageConfig;
};

// ============================================================================
// Pipeline Input
// ============================================================================

/**
 * OpenAI client interface - minimal interface for dependency injection
 */
export type OpenAIClient = {
  chat: {
    completions: {
      create: (params: {
        model: string;
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        max_completion_tokens: number;
        temperature?: number;
        top_p?: number;
      }) => Promise<{
        choices: {
          message: {
            content: string | null;
            refusal?: string | null;
          };
          finish_reason?: string | null;
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      }>;
    };
  };
};

/**
 * Match data input for the pipeline
 */
export type PipelineMatchInput = {
  /** Processed match data (our internal format) */
  processed: CompletedMatch | ArenaMatch;
  /** Raw match data from Riot API (required for match summary generation) */
  raw: RawMatch;
  /** Raw timeline data from Riot API (required for timeline summary) */
  rawTimeline: RawTimeline;
};

/**
 * Player input for the pipeline
 */
export type PipelinePlayerInput = {
  /** Index of the player in the match (0-based) */
  index: number;
};

/**
 * Prompts and personality input for the pipeline
 */
export type PipelinePromptsInput = {
  /** The personality to use for review generation */
  personality: Personality;
  /** Lane-specific context text */
  laneContext: string;
};

/**
 * AI clients input for the pipeline
 */
export type PipelineClientsInput = {
  /** OpenAI client for text generation */
  openai: OpenAIClient;
  /** Gemini client for image generation (optional) */
  gemini?: GoogleGenerativeAI;
};

/**
 * Complete input for the review pipeline
 */
export type ReviewPipelineInput = {
  /** Match data */
  match: PipelineMatchInput;
  /** Player to review */
  player: PipelinePlayerInput;
  /** Prompts and personality */
  prompts: PipelinePromptsInput;
  /** AI clients (injected) */
  clients: PipelineClientsInput;
  /** Per-stage configuration */
  stages: PipelineStagesConfig;
  /** Optional callback for progress updates */
  onProgress?: PipelineProgressCallback;
};

// ============================================================================
// Pipeline Output - Traces
// ============================================================================

/**
 * Trace for a text generation stage (OpenAI call)
 */
export type StageTrace = {
  request: {
    systemPrompt?: string;
    userPrompt: string;
  };
  response: {
    text: string;
  };
  model: ModelConfig;
  durationMs: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
};

/**
 * Trace for image generation stage (Gemini call)
 */
export type ImageGenerationTrace = {
  request: {
    prompt: string;
  };
  response: {
    imageGenerated: boolean;
    imageSizeBytes?: number;
  };
  model: string;
  durationMs: number;
};

/**
 * Trace for a timeline chunk (individual chunk processing)
 */
export type TimelineChunkTrace = {
  /** Zero-based index of this chunk */
  chunkIndex: number;
  /** Time range of this chunk (e.g., "0:00 - 10:00") */
  timeRange: string;
  /** The stage trace for this chunk */
  trace: StageTrace;
};

/**
 * All pipeline traces
 */
export type PipelineTraces = {
  /** Stage 1a trace (timeline summary - for chunked processing, this is the aggregate trace) */
  timelineSummary?: StageTrace;
  /** Stage 1a traces for chunked processing (individual chunk traces) */
  timelineChunks?: TimelineChunkTrace[];
  /** Stage 1b trace */
  matchSummary?: StageTrace;
  /** Stage 2 trace (always present) */
  reviewText: StageTrace;
  /** Stage 3 trace */
  imageDescription?: StageTrace;
  /** Stage 4 trace */
  imageGeneration?: ImageGenerationTrace;
};

// ============================================================================
// Pipeline Output - Intermediate Results
// ============================================================================

/**
 * Intermediate results from the pipeline (for debugging/dev tool)
 */
export type PipelineIntermediateResults = {
  /** Text output from Stage 1a (final aggregated summary) */
  timelineSummaryText?: string;
  /** Individual chunk summaries from Stage 1a (if chunked processing used) */
  timelineChunkSummaries?: string[];
  /** Text output from Stage 1b */
  matchSummaryText?: string;
  /** Text output from Stage 3 */
  imageDescriptionText?: string;
  /** Image prompts selected from personality for Stage 3 (2-3 random picks) */
  selectedImagePrompts?: string[];
  /** Art style selected for Stage 3 image description */
  selectedArtStyle?: string;
};

// ============================================================================
// Pipeline Output - Context
// ============================================================================

/**
 * Context about the generated review
 */
export type PipelineContext = {
  /** Name of the reviewer personality */
  reviewerName: string;
  /** Name of the player being reviewed */
  playerName: string;
  /** Index of the player in the match */
  playerIndex: number;
  /** Personality information */
  personality: {
    filename?: string;
    name: string;
  };
};

// ============================================================================
// Pipeline Output
// ============================================================================

/**
 * Final review output
 */
export type PipelineReviewOutput = {
  /** The generated review text */
  text: string;
  /** Base64-encoded image (if image generation enabled and successful) */
  imageBase64?: string;
};

/**
 * Complete output from the review pipeline
 */
export type ReviewPipelineOutput = {
  /** Final review outputs */
  review: PipelineReviewOutput;
  /** Per-stage traces (for observability/S3) */
  traces: PipelineTraces;
  /** Intermediate results (for debugging/dev tool) */
  intermediate: PipelineIntermediateResults;
  /** Context about the review */
  context: PipelineContext;
};

// ============================================================================
// Pipeline Progress
// ============================================================================

/**
 * Names of pipeline stages for progress tracking
 */
export type PipelineStageName =
  | "timeline-summary"
  | "timeline-chunk"
  | "timeline-aggregate"
  | "match-summary"
  | "review-text"
  | "image-description"
  | "image-generation";

/**
 * Progress update from the pipeline
 */
export type PipelineProgress = {
  /** Current stage being executed */
  stage: PipelineStageName;
  /** Human-readable message */
  message: string;
  /** Current stage number (1-based) */
  currentStage: number;
  /** Total number of enabled stages */
  totalStages: number;
  /** For chunked stages: current chunk index (1-based) */
  chunkIndex?: number;
  /** For chunked stages: total number of chunks */
  chunkTotal?: number;
};

/**
 * Callback for pipeline progress updates
 */
export type PipelineProgressCallback = (progress: PipelineProgress) => void;
