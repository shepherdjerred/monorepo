import { z } from "zod";
import { ChampionSchema } from "#src/model/champion.ts";

export type Roster = z.infer<typeof RosterSchema>;
export const RosterSchema = z.array(ChampionSchema).length(5);
