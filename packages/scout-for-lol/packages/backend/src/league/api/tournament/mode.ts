import { z } from "zod";

/**
 * Which tournament API the client talks to.
 *
 * `stub` is `tournament-stub-v5`, which any development or standard League key
 * can call. It returns well-formed but non-functional data: the codes it mints
 * do not create a real in-client lobby, its lobby events are canned, and it has
 * no `games/by-code` endpoint at all. It exercises our code paths and nothing
 * about a real game.
 *
 * `live` is `tournament-v5`, which needs a production key with tournament
 * access granted.
 */
export const TournamentApiModeSchema = z.enum(["stub", "live"]);
export type TournamentApiMode = z.infer<typeof TournamentApiModeSchema>;

const LIVE_BASE_PATH = "lol/tournament/v5";
const STUB_BASE_PATH = "lol/tournament-stub/v5";

export function tournamentBasePath(mode: TournamentApiMode): string {
  return mode === "stub" ? STUB_BASE_PATH : LIVE_BASE_PATH;
}

/**
 * Whether `GET /games/by-code` exists in this mode.
 *
 * Callers branch on this rather than catching a 404, because the capability is
 * known statically from configuration — a 404 would also be how Riot reports a
 * code it has never seen, and conflating the two would turn "we are on the
 * stub" into "that lobby never played".
 */
export function supportsGamesByCode(mode: TournamentApiMode): boolean {
  return mode === "live";
}
