import { z } from "zod";
import { RanksSchema } from "#src/model/riot/rank.ts";
import { PlayerConfigEntrySchema } from "#src/model/riot/player-config.ts";
export type Player = z.infer<typeof PlayerSchema>;
export const PlayerSchema = z.strictObject({
  config: PlayerConfigEntrySchema,
  ranks: RanksSchema,
});
