import { z } from "zod";

export type LeagueSummonerId = z.infer<typeof LeagueSummonerIdSchema>;
export const LeagueSummonerIdSchema = z
  .string()
  .min(1)
  .max(63)
  .brand<"LeagueSummonerId">();

export type LeaguePuuid = z.infer<typeof LeaguePuuidSchema>;
export const LeaguePuuidSchema = z
  .union([z.uuid(), z.string().length(78)])
  .brand<"LeaguePuuid">();
