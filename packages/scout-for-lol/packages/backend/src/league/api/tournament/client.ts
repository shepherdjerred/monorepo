import {
  RawLobbyEventListSchema,
  RawTournamentCodeSchema,
  RawTournamentCodesSchema,
  RawTournamentGamesSchema,
  RawTournamentIdSchema,
  type RawLobbyEvent,
  type RawProviderRegistrationParameters,
  type RawTournamentCode,
  type RawTournamentCodeParameters,
  type RawTournamentGame,
  type RawTournamentRegistrationParameters,
} from "@scout-for-lol/data/index.ts";
import {
  callRiotOrThrow,
  callRiotOrUndefined,
} from "#src/league/api/riot-call.ts";
import {
  tournamentBasePath,
  supportsGamesByCode,
} from "#src/league/api/tournament/mode.ts";
import type { TournamentApiMode } from "#src/configuration/tournament-mode.ts";
import { tournamentFetch } from "#src/league/api/tournament/http.ts";

/**
 * Typed tournament-v5 calls.
 *
 * Every call routes through `riot-call.ts` rather than talking to `fetch`
 * directly, so this hand-rolled client inherits the same guarantees as every
 * twisted-backed call: Sentry breadcrumbs, `riotApiRequestsTotal` /
 * `riotApiErrorsTotal`, `updateRiotApiHealth` (which feeds `/healthz`), the
 * 30-second timeout, `parseWithUnknownKeyFallback` plus its drift counter, and
 * the 404 / expected-outage policy.
 *
 * The split between throwing and undefined-returning variants is deliberate:
 *
 * - Command-path calls throw. A failed `/lobby create` has to tell the operator
 *   why; folding the failure to `undefined` would produce a silent no-op.
 * - Poll-path calls return `undefined` and set `sentry: false`. The poller runs
 *   every 20 seconds, so reporting each failure would flood error tracking; its
 *   circuit breaker already does rate-limited reporting.
 */

export type TournamentClientOptions = {
  readonly mode: TournamentApiMode;
};

export async function registerProvider(
  options: TournamentClientOptions,
  parameters: RawProviderRegistrationParameters,
): Promise<number> {
  return callRiotOrThrow(
    {
      source: "tournament-provider",
      schema: RawTournamentIdSchema,
      schemaLabel: "tournament-provider",
      context: { region: parameters.region, mode: options.mode },
      sentry: true,
    },
    () =>
      tournamentFetch(tournamentBasePath(options.mode), {
        method: "POST",
        path: "providers",
        body: parameters,
      }),
  );
}

export async function registerTournament(
  options: TournamentClientOptions,
  parameters: RawTournamentRegistrationParameters,
): Promise<number> {
  return callRiotOrThrow(
    {
      source: "tournament-registration",
      schema: RawTournamentIdSchema,
      schemaLabel: "tournament-registration",
      context: { providerId: parameters.providerId, mode: options.mode },
      sentry: true,
    },
    () =>
      tournamentFetch(tournamentBasePath(options.mode), {
        method: "POST",
        path: "tournaments",
        body: parameters,
      }),
  );
}

export async function createTournamentCodes(
  options: TournamentClientOptions,
  tournamentId: number,
  count: number,
  parameters: RawTournamentCodeParameters,
): Promise<string[]> {
  return callRiotOrThrow(
    {
      source: "tournament-codes",
      schema: RawTournamentCodesSchema,
      schemaLabel: "tournament-codes",
      context: { tournamentId, count, mode: options.mode },
      sentry: true,
    },
    () =>
      tournamentFetch(tournamentBasePath(options.mode), {
        method: "POST",
        path: "codes",
        query: {
          tournamentId: tournamentId.toString(),
          count: count.toString(),
        },
        body: parameters,
      }),
  );
}

export async function getTournamentCode(
  options: TournamentClientOptions,
  code: string,
): Promise<RawTournamentCode> {
  return callRiotOrThrow(
    {
      source: "tournament-code",
      schema: RawTournamentCodeSchema,
      schemaLabel: "tournament-code",
      context: { code, mode: options.mode },
      sentry: true,
    },
    () =>
      tournamentFetch(tournamentBasePath(options.mode), {
        method: "GET",
        path: `codes/${encodeURIComponent(code)}`,
      }),
  );
}

/**
 * The full event list for a code, which Riot replays in its entirety on every
 * call. Callers must therefore be idempotent over a replay.
 */
export async function getLobbyEvents(
  options: TournamentClientOptions,
  code: string,
): Promise<RawLobbyEvent[] | undefined> {
  const result = await callRiotOrUndefined(
    {
      source: "tournament-lobby-events",
      schema: RawLobbyEventListSchema,
      schemaLabel: "tournament-lobby-events",
      context: { code, mode: options.mode },
      sentry: false,
    },
    () =>
      tournamentFetch(tournamentBasePath(options.mode), {
        method: "GET",
        path: `lobby-events/by-code/${encodeURIComponent(code)}`,
      }),
  );
  return result?.eventList;
}

/**
 * Games recorded against a code.
 *
 * Only exists on tournament-v5. Calling it in stub mode is a caller bug, not a
 * runtime condition to absorb — `supportsGamesByCode` answers the question
 * statically, so reaching here means someone skipped the check.
 */
export async function getGamesByCode(
  options: TournamentClientOptions,
  code: string,
): Promise<RawTournamentGame[] | undefined> {
  if (!supportsGamesByCode(options.mode)) {
    throw new Error(
      "games/by-code does not exist on tournament-stub-v5; guard the call with supportsGamesByCode()",
    );
  }
  return callRiotOrUndefined(
    {
      source: "tournament-games",
      schema: RawTournamentGamesSchema,
      schemaLabel: "tournament-games",
      context: { code, mode: options.mode },
      sentry: false,
    },
    () =>
      tournamentFetch(tournamentBasePath(options.mode), {
        method: "GET",
        path: `games/by-code/${encodeURIComponent(code)}`,
      }),
  );
}
