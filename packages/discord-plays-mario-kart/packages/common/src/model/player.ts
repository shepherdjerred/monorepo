import { z } from "zod";

export type Player = z.infer<typeof PlayerSchema>;
export const PlayerSchema = z.strictObject({
  discordId: z.string(),
  discordUsername: z.string(),
});
