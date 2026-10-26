import { z } from "zod";
/** Riot's numeric team identifiers on Summoner's Rift. */
export const RiotTeamIdSchema = z.union([z.literal(100), z.literal(200)]);
export type RiotTeamId = z.infer<typeof RiotTeamIdSchema>;
