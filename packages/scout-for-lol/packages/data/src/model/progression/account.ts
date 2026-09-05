import { z } from "zod";

export const ProgressionAccountSchema = z.strictObject({
  playerId: z.number().int().positive(),
  playerAlias: z.string().min(1),
  accountId: z.number().int().positive(),
  accountAlias: z.string().min(1),
  puuid: z.string().min(1),
});
export type ProgressionAccount = z.infer<typeof ProgressionAccountSchema>;
