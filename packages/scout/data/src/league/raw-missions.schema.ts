import { z } from "zod";

/**
 * Raw Missions - Arena games only, from Riot API
 * Values are only set in arena games
 */
export const RawMissionsSchema = z
  .object({
    playerScore0: z.number(),
    playerScore1: z.number(),
    playerScore2: z.number(),
    playerScore3: z.number(),
    playerScore4: z.number(),
    playerScore5: z.number(),
    playerScore6: z.number(),
    playerScore7: z.number(),
    playerScore8: z.number(),
    playerScore9: z.number(),
    playerScore10: z.number(),
    playerScore11: z.number(),
  })
  .strict();

export type RawMissions = z.infer<typeof RawMissionsSchema>;
