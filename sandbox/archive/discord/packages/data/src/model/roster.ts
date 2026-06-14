import { z } from "https://esm.sh/zod@3.22.4";
import { ChampionSchema } from "./champion.ts";

export type Roster = z.infer<typeof RosterSchema>;
export const RosterSchema = z.array(ChampionSchema).length(5);
