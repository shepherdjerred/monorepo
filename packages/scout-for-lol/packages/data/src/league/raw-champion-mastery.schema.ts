import { z } from "zod";

/**
 * Published Champion-Mastery-V4 row used by Scout's read-only Explore tool.
 *
 * Riot no longer returns `chestGranted`; it is intentionally absent here.
 * Unknown keys strip on parse, so stored snapshots written while Riot still
 * sent the field continue to validate.
 */
export const RawChampionMasterySchema = z.object({
  puuid: z.string().min(1),
  championId: z.number().int().positive(),
  championLevel: z.number().int().nonnegative(),
  championPoints: z.number().int().nonnegative(),
  lastPlayTime: z.number().int().nonnegative(),
  championPointsSinceLastLevel: z.number().int(),
  championPointsUntilNextLevel: z.number().int(),
  tokensEarned: z.number().int().nonnegative(),
});
export const RawChampionMasteryListSchema = z.array(RawChampionMasterySchema);
export type RawChampionMastery = z.infer<typeof RawChampionMasterySchema>;
