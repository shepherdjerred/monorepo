import { z } from "zod";

export const StandardRankedQueueTypeSchema = z.enum([
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
  "RANKED_TEAM_5x5",
]);
export type StandardRankedQueueType = z.infer<
  typeof StandardRankedQueueTypeSchema
>;

export const StandardRankedTierSchema = z.enum([
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
]);

export const StandardRankedDivisionSchema = z.enum(["I", "II", "III", "IV"]);

const StandardMiniSeriesSchema = z.strictObject({
  target: z.number().int().nonnegative().default(0),
  wins: z.number().int().nonnegative().default(0),
  losses: z.number().int().nonnegative().default(0),
  progress: z.string(),
});

/**
 * A published Solo/Duo, Flex, or Ranked 5s rank from League-V4. Riot omits numeric fields
 * whose value is zero, so those fields normalize to zero at this boundary.
 * Unknown-field auditing is performed by RawSummonerLeagueSchema before this
 * schema is used to interpret a relevant entry.
 */
export const StandardSummonerLeagueSchema = z.strictObject({
  leagueId: z.string().optional(),
  queueType: StandardRankedQueueTypeSchema,
  tier: StandardRankedTierSchema,
  rank: StandardRankedDivisionSchema,
  summonerId: z.string().optional(),
  puuid: z.string().optional(),
  leaguePoints: z.number().int().nonnegative().default(0),
  wins: z.number().int().nonnegative().default(0),
  losses: z.number().int().nonnegative().default(0),
  veteran: z.boolean().optional(),
  inactive: z.boolean().optional(),
  freshBlood: z.boolean().optional(),
  hotStreak: z.boolean().optional(),
  miniSeries: StandardMiniSeriesSchema.optional(),
});
export type StandardSummonerLeague = z.infer<
  typeof StandardSummonerLeagueSchema
>;

/**
 * Raw League-V4 entry. Queue names are intentionally open because Riot can
 * add unrelated queues without changing Scout's Solo/Flex rank contract.
 * Known fields remain unknown until the queue is identified; malformed Arena,
 * TFT, or future queue variants therefore cannot poison valid Solo/Flex data.
 */
export const RawSummonerLeagueSchema = z
  .strictObject({
    leagueId: z.unknown().optional(),
    queueType: z.string().min(1),
    tier: z.unknown().optional(),
    rank: z.unknown().optional(),
    summonerId: z.unknown().optional(),
    puuid: z.unknown().optional(),
    leaguePoints: z.unknown().optional(),
    wins: z.unknown().optional(),
    losses: z.unknown().optional(),
    veteran: z.unknown().optional(),
    inactive: z.unknown().optional(),
    freshBlood: z.unknown().optional(),
    hotStreak: z.unknown().optional(),
    ratedTier: z.unknown().optional(),
    ratedRating: z.unknown().optional(),
    miniSeries: z.unknown().optional(),
  })
  .superRefine((entry, context) => {
    if (!StandardRankedQueueTypeSchema.safeParse(entry.queueType).success) {
      return;
    }

    const parsed = StandardSummonerLeagueSchema.safeParse(entry);
    if (parsed.success) {
      return;
    }

    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        context.addIssue({
          code: "unrecognized_keys",
          keys: issue.keys,
          message: issue.message,
          path: issue.path,
        });
        continue;
      }

      context.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
  });

export const RawSummonerLeagueListSchema = z.array(RawSummonerLeagueSchema);
export type RawSummonerLeague = z.infer<typeof RawSummonerLeagueSchema>;
