import { z } from "https://esm.sh/zod@3.22.4";
import { LeagueAcccountSchema } from "./leagueAccount.ts";
import { DiscordSchema } from "./discord.ts";
import { GlitterTierSchema } from "./glitterTier.ts";

export type PlayerConfigEntry = z.infer<typeof PlayerConfigEntrySchema>;
export const PlayerConfigEntrySchema = z.strictObject({
  name: z.string(),
  league: z.strictObject({
    leagueAccount: LeagueAcccountSchema,
    alts: z.array(LeagueAcccountSchema),
  }),
  discordAccount: DiscordSchema,
  tier: GlitterTierSchema.optional(),
});

export type PlayerConfig = z.infer<typeof PlayerConfigSchema>;
export const PlayerConfigSchema = z.array(PlayerConfigEntrySchema);
