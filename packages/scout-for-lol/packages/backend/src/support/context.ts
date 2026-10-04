import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { z } from "zod";

export const SupportContextSchema = z.strictObject({
  page: z
    .string()
    .max(300)
    .regex(/^\/app\/[\w./%-]*$/)
    .optional(),
  matchId: z
    .string()
    .max(100)
    .regex(/^[A-Z0-9]+_\d+$/)
    .optional(),
  serverId: DiscordGuildIdSchema.optional(),
});
