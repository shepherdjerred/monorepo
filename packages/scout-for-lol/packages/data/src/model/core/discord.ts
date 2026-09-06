import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";

export {
  type DiscordAccountId,
  DiscordAccountIdSchema,
  type DiscordChannelId,
  DiscordChannelIdSchema,
  type DiscordGuildId,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";

export type Discord = z.infer<typeof DiscordSchema>;
export const DiscordSchema = z.strictObject({
  id: DiscordAccountIdSchema.optional(),
});
