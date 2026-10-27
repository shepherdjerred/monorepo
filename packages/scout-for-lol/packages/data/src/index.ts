export * from "./model/index.ts";
export * from "./customs/customs.schema.ts";
export * from "./scout-client/protocol.schema.ts";
export * from "./scout-client/lcu-clash.schema.ts";
export * from "./seasons.ts";

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
