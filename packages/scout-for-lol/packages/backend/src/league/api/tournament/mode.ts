import type { TournamentApiMode } from "#src/configuration/tournament-mode.ts";

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
