import { z } from "zod";
import { LeaguePuuidSchema } from "#src/model/riot/league-account.ts";
import {
  RiotGameNameSchema,
  RiotTagLineSchema,
} from "#src/model/core/identifiers.ts";

export const RawAccountSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  gameName: RiotGameNameSchema,
  tagLine: RiotTagLineSchema,
});

export type RawAccount = z.infer<typeof RawAccountSchema>;
