import { z } from "zod";
import { ChampionSchema } from "#src/model/champion.ts";

export type Roster = z.infer<typeof RosterSchema>;
/**
 * One side of a match, 1-5 champions.
 *
 * Not `.length(5)`: tournament-code custom lobbies carry a `teamSize` of 1-5,
 * and even a 5v5 can finish uneven when someone dodges or never connects. The
 * sides are deliberately NOT constrained to be equal for the same reason —
 * `ClassicRosterSchema` made the same call, and the committed visual contract
 * already ships a `postmatch-partial-3v2` artifact.
 */
export const RosterSchema = z.array(ChampionSchema).min(1).max(5);
