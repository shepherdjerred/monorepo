import { DiscordGuildIdSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import { z } from "zod";

export const SupportContextSchema = z.strictObject({
  page: z
    .string()
    .max(300)
    .regex(/^\/app\/[\w./%-]*$/)
    .optional(),
  matchId: RiotMatchIdSchema.optional(),
  serverId: DiscordGuildIdSchema.optional(),
});
