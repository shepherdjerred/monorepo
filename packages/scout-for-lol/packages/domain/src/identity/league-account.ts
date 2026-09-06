import { z } from "zod";

export type LeagueSummonerId = z.infer<typeof LeagueSummonerIdSchema>;
export const LeagueSummonerIdSchema = z
  .string()
  .min(0)
  .max(63)
  .brand<"LeagueSummonerId">();

export type LeaguePuuid = z.infer<typeof LeaguePuuidSchema>;
export const LeaguePuuidSchema = z
  .string()
  .min(78)
  .max(78)
  .brand<"LeaguePuuid">();
