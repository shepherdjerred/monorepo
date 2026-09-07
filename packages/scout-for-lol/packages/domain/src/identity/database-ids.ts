import { z } from "zod";

export const PlayerIdSchema = z.number().int().positive().brand<"PlayerId">();
export type PlayerId = z.infer<typeof PlayerIdSchema>;

export const AccountIdSchema = z.number().int().positive().brand<"AccountId">();
export type AccountId = z.infer<typeof AccountIdSchema>;
