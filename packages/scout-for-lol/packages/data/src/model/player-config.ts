import { z } from "zod";
import { LeagueAccountSchema } from "@scout-for-lol/data/model/league-account";
import { DiscordSchema } from "@scout-for-lol/data/model/discord";

export type PlayerConfigEntry = z.infer<typeof PlayerConfigEntrySchema>;
export const PlayerConfigEntrySchema = z.strictObject({
  alias: z.string(),
  league: z.strictObject({
    leagueAccount: LeagueAccountSchema,
  }),
  discordAccount: DiscordSchema.nullable().optional(),
});

export type PlayerConfig = z.infer<typeof PlayerConfigSchema>;
export const PlayerConfigSchema = z.array(PlayerConfigEntrySchema);
