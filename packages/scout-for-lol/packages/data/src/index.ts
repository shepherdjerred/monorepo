/* eslint-disable custom-rules/no-re-exports -- data package is a library, so re-exports are intentional */
export * from "./model/index.ts";
export * from "./seasons.ts";
export * from "./review/art-styles.ts";
export { ART_STYLES } from "./review/art-styles-list.ts";
export type { ArtStyle } from "./review/art-categories.ts";
export * from "./review/models.ts";
export * from "./review/prompts.ts";
export * from "./review/image-prompt.ts";
export {
  type ReviewTextMetadata,
  type ReviewImageMetadata,
  type ChatCompletionCreateParams,
} from "./review/generator.ts";
export { extractMatchData, getOrdinalSuffix } from "./review/generator-helpers.ts";
export {
  buildTimelineEnrichment,
  enrichTimelineData,
  type ParticipantLookup,
  type TimelineEnrichment,
  type EnrichedTimelineData,
} from "./review/timeline-enricher.ts";

// Pipeline exports
export { generateFullMatchReview } from "./review/pipeline.ts";
export {
  generateTimelineSummary,
  generateTimelineChunkSummary,
  aggregateTimelineChunks,
} from "./review/timeline-stages.ts";
export {
  generateMatchSummary,
  generateReviewTextStage,
  generateImageDescription,
  generateImage,
} from "./review/pipeline-stages.ts";
export {
  getDefaultStageConfigs,
  DEFAULT_TIMELINE_SUMMARY_MODEL,
  DEFAULT_MATCH_SUMMARY_MODEL,
  DEFAULT_REVIEW_TEXT_MODEL,
  DEFAULT_IMAGE_DESCRIPTION_MODEL,
  DEFAULT_IMAGE_GENERATION_MODEL,
  DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
  // System prompts
  TIMELINE_SUMMARY_SYSTEM_PROMPT,
  MATCH_SUMMARY_SYSTEM_PROMPT,
  REVIEW_TEXT_SYSTEM_PROMPT,
  IMAGE_DESCRIPTION_SYSTEM_PROMPT,
  // User prompts
  TIMELINE_SUMMARY_USER_PROMPT,
  MATCH_SUMMARY_USER_PROMPT,
  REVIEW_TEXT_USER_PROMPT,
  IMAGE_DESCRIPTION_USER_PROMPT,
  IMAGE_GENERATION_USER_PROMPT,
  createStageConfigs,
} from "./review/pipeline-defaults.ts";
export type {
  ModelConfig,
  StageConfig,
  ReviewTextStageConfig,
  ImageGenerationStageConfig,
  PipelineStagesConfig,
  OpenAIClient,
  PipelineMatchInput,
  PipelinePlayerInput,
  PipelinePromptsInput,
  PipelineClientsInput,
  ReviewPipelineInput,
  StageTrace,
  ImageGenerationTrace,
  TimelineChunkTrace,
  PipelineTraces,
  PipelineIntermediateResults,
  PipelineContext,
  PipelineReviewOutput,
  ReviewPipelineOutput,
  PipelineStageName,
  PipelineProgress,
  PipelineProgressCallback,
} from "./review/pipeline-types.ts";

// Prompt variable metadata (single source of truth for frontend/backend)
export { STAGE_PROMPT_VARIABLES, PROMPT_STAGE_NAMES, getStageVariables } from "./review/prompt-variables.ts";
export type {
  PromptVariable,
  StagePromptVariables,
  PromptStageName,
  StagePromptVariablesMap,
} from "./review/prompt-variables.ts";

export * from "./league/raw-match.schema.ts";
export * from "./league/raw-participant.schema.ts";
export * from "./league/raw-perks.schema.ts";
export * from "./league/raw-challenges.schema.ts";
export * from "./league/raw-timeline.schema.ts";
export * from "./league/raw-summoner-league.schema.ts";
export { getExampleMatch, type AnyMatch } from "./example/example.ts";
export * from "./data-dragon/version.ts";
export * from "./data-dragon/summoner.ts";
export * from "./data-dragon/item.ts";
export * from "./data-dragon/runes.ts";
export { getChampionInfo, getChampionList } from "./data-dragon/champion.ts";
export { arenaAugmentCache, getCachedArenaAugmentById } from "./data-dragon/arena-augments.ts";

// Sound pack exports
export * from "./sound-pack/index.ts";
export {
  // URL getters (synchronous, for browser/frontend use)
  getChampionImageUrl,
  getItemImageUrl,
  getSpellImageUrl,
  getRuneIconUrl,
  getAugmentIconUrl,
  // Base64 getters (async, for Satori/server-side rendering)
  getChampionImageBase64,
  getItemImageBase64,
  getSpellImageBase64,
  getRuneIconBase64,
  getAugmentIconBase64,
  // Validation functions (async)
  validateChampionImage,
  validateItemImage,
  validateSpellImage,
  validateRuneIcon,
  validateAugmentIcon,
} from "./data-dragon/images.ts";
