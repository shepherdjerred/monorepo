export * from "./model/index.ts";
export * from "./customs/customs.schema.ts";
export * from "./scout-client/protocol.schema.ts";
export * from "./scout-client/lcu-clash.schema.ts";
export { getStyleCard } from "@shepherdjerred/glitter-context";
export { serializeStyleCardForScoutPrompt } from "./review/art/style-card-prompt.ts";
export * from "./seasons.ts";
export * from "./review/art/art-styles.ts";
export * from "./review/models.ts";
export * from "./review/prompts.ts";
export * from "./review/exceptional-performance.ts";
export { getOrdinalSuffix } from "./review/generator-helpers.ts";
export { requirePlayerAtIndex } from "./review/player-index.ts";
// Pipeline exports
export { generateFullMatchReview } from "./review/pipeline/pipeline.ts";
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
} from "./review/pipeline/pipeline-defaults.ts";
export type {
  PipelineStagesConfig,
  TextGenerationClient,
  ImageGenerationClient,
  StageTrace,
  ImageGenerationTrace,
  PipelineContext,
  ReviewPipelineOutput,
} from "./review/pipeline/pipeline-types.ts";

// Prompt variable metadata (single source of truth for frontend/backend)
export {
  STAGE_PROMPT_VARIABLES,
  PROMPT_STAGE_NAMES,
} from "./review/prompt-variables.ts";
export type { PromptStageName } from "./review/prompt-variables.ts";

export * from "./league/data-source.ts";
export * from "./league/raw-match.schema.ts";
export * from "./league/raw-clash.schema.ts";
export * from "./league/raw-participant.schema.ts";
export * from "./league/raw-team.schema.ts";
export * from "./league/raw-perks.schema.ts";
export * from "./league/raw-challenges.schema.ts";
export * from "./league/raw-timeline.schema.ts";
export * from "./league/raw-summoner-league.schema.ts";
export * from "./league/raw-champion-mastery.schema.ts";
export * from "./league/raw-current-game-info.schema.ts";
export * from "./league/raw-account.schema.ts";
export * from "./lane-priors/schema.ts";
export * from "./lane-priors/inference.ts";
export * from "./lane-priors/current.ts";
export * from "./lane-priors/build.ts";
export * from "./lane-priors/eval.ts";
export { getExampleMatch, type AnyMatch } from "./example/example.ts";
export * from "./data-dragon/version.ts";
export * from "./data-dragon/summoner.ts";
export * from "./data-dragon/classic.ts";
export * from "./data-dragon/item.ts";
export * from "./data-dragon/runes.ts";
export {
  ChampionTagSchema,
  getChampionInfo,
  getChampionList,
  getChampionTags,
  type ChampionTag,
} from "./data-dragon/champion.ts";
export {
  getAbilityFacts,
  suggestChampionNames,
  type AbilityFacts,
  type AbilitySlot,
} from "./data-dragon/ability-facts.ts";
export {
  getPatchChangeset,
  getPatchChangesets,
  selectRelevantPatchChanges,
  formatPatchNotes,
} from "./data-dragon/patch-notes.ts";
export { getCachedAugmentNameById } from "./data-dragon/augment-names.ts";

// Sound pack exports
export {
  // URL getters (synchronous, for browser/frontend use)
  getChampionImageUrl,
  // Base64 getters (async, for Satori/server-side rendering)
  getChampionImageBase64,
  getItemImageBase64,
  getSpellImageBase64,
  getRuneIconBase64,
  getAugmentIconBase64,
  getLaneIconBase64,
  getChampionLoadingImageBase64,
  getChampionSplashImageBase64,
  getClassicBackgroundBase64,
  // Validation functions (async)
  validateChampionImage,
  validateChampionLoadingImage,
  validateChampionSplashImage,
  getChampionKeyById,
  championNameToDisplayName,
  getChampionDisplayNameById,
} from "./data-dragon/images.ts";
export { gameResultTimestamp } from "@scout-for-lol/domain/artifacts/game-result.ts";
