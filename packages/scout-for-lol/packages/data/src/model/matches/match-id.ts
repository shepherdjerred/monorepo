// The Riot match id brand lives in @scout-for-lol/domain. This shim gives
// `@scout-for-lol/data` consumers that schema object itself, so a match id
// parsed on either side is the same brand with the same validation.
export {
  type RiotMatchId,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
