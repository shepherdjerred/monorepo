import { z } from "https://esm.sh/zod@3.22.4";

export type Discord = z.infer<typeof DiscordSchema>;
export const DiscordSchema = z.strictObject({
  id: z.string().min(0),
});
