import { riotClient } from "#src/league/api/api.ts";
import {
  type Region,
  type RawCurrentGameInfo,
  type LeaguePuuid,
  RawCurrentGameInfoSchema,
  regionToPlatformRoute,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import {
  riotApiErrorsTotal,
  riotApiRequestsTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import {
  extractHttpStatus,
  isExpectedUpstreamError,
} from "#src/league/api/client/errors.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("spectator-api");

/**
 * What one spectator call actually established.
 *
 * Three outcomes, not two, and the third one is the point. `not-in-game` is a
 * CONFIRMED absence: Riot answered 404, so the account is provably not in a
 * game. `unavailable` is the absence of an ANSWER — a timeout, a 401, a 429, a
 * payload that failed its schema, an upstream 5xx — and it establishes nothing
 * at all about whether a game exists.
 *
 * These used to collapse into one `game: undefined`, which is safe only for a
 * caller that re-polls on a timer and can afford to miss a tick. A caller whose
 * conclusion is DURABLE — a Temporal Workflow whose completed, game-scoped ID
 * blocks every later poll — would turn one transient blip into a permanently
 * lost snapshot. Absence of evidence is not evidence of absence, and this
 * boundary is where the two stop being the same value.
 *
 * `upstream` stays a separate flag rather than folding into `reason` because it
 * carries an operational decision: the circuit breaker engages on an upstream
 * outage and on nothing else.
 */
export type SpectatorResult =
  | { kind: "in-game"; game: RawCurrentGameInfo }
  | { kind: "not-in-game" }
  | { kind: "unavailable"; upstream: boolean; reason: string };

/**
 * Fetch active game data for a player from the Spectator V5 API.
 *
 * @returns Which of the three outcomes above this call established.
 */
export async function getActiveGame(
  puuid: LeaguePuuid,
  region: Region,
): Promise<SpectatorResult> {
  try {
    const platform = regionToPlatformRoute(region);

    Sentry.addBreadcrumb({
      category: "riot-api",
      message: `Checking active game for ${puuid}`,
      data: { puuid, region, platform, endpoint: "SpectatorV5.activeGame" },
      level: "info",
    });

    logger.info(`[getActiveGame] 🔍 Checking active game for ${puuid}`);
    const rawGame = await withTimeout(
      riotClient.spectator.activeGame(puuid, platform),
    );

    riotApiRequestsTotal.inc({ source: "spectator", status: "success" });
    updateRiotApiHealth(true);

    // Validate the response against our schema
    const parseResult = RawCurrentGameInfoSchema.safeParse(rawGame);
    if (!parseResult.success) {
      logger.error(
        `[getActiveGame] ❌ Spectator data validation failed for ${puuid}:`,
        parseResult.error,
      );
      riotApiErrorsTotal.inc({
        source: "spectator-validation",
        http_status: "validation",
      });
      Sentry.captureException(parseResult.error, {
        tags: {
          source: "spectator-validation",
          puuid,
          region,
        },
      });
      // Riot answered, but not with something this code can trust. That is a
      // broken boundary, never a statement that the account is idle.
      return {
        kind: "unavailable",
        upstream: false,
        reason: "payload-failed-validation",
      };
    }

    logger.info(
      `[getActiveGame] ✅ ${puuid} is in game ${parseResult.data.gameId.toString()} (${parseResult.data.gameMode})`,
    );
    return { kind: "in-game", game: parseResult.data };
  } catch (error: unknown) {
    // 404 = player not in a game — expected/normal case
    const httpStatus = extractHttpStatus(error);

    if (httpStatus === 404) {
      riotApiRequestsTotal.inc({ source: "spectator", status: "not_found" });
      updateRiotApiHealth(true);
      logger.debug(`[getActiveGame] Player ${puuid} not in game`);
      // The only confirmed absence: Riot looked and there is no game.
      return { kind: "not-in-game" };
    }

    // 502/503/504 = Riot upstream outage — expected during maintenance windows.
    // Do NOT report to Sentry here; the caller's circuit breaker handles
    // rate-limited reporting. Just log at warn level and signal upstreamError.
    if (httpStatus !== undefined && isExpectedUpstreamError(httpStatus)) {
      riotApiRequestsTotal.inc({
        source: "spectator",
        status: "upstream_error",
      });
      riotApiErrorsTotal.inc({
        source: "spectator",
        http_status: httpStatus.toString(),
      });
      updateRiotApiHealth(false);
      logger.warn(
        `[getActiveGame] Riot API returned ${httpStatus.toString()} for ${puuid} (expected upstream error)`,
      );
      return {
        kind: "unavailable",
        upstream: true,
        reason: `upstream-${httpStatus.toString()}`,
      };
    }

    riotApiRequestsTotal.inc({
      source: "spectator",
      status:
        error instanceof Error && error.message.includes("timed out")
          ? "timeout"
          : "error",
    });
    updateRiotApiHealth(false);

    if (httpStatus === undefined) {
      logger.error(
        `[getActiveGame] ❌ Error checking active game for ${puuid}:`,
        error,
      );
      riotApiErrorsTotal.inc({ source: "spectator", http_status: "unknown" });
    } else {
      logger.error(
        `[getActiveGame] ❌ HTTP Error ${httpStatus.toString()} for ${puuid}`,
      );
      riotApiErrorsTotal.inc({
        source: "spectator",
        http_status: httpStatus.toString(),
      });
      Sentry.captureException(error, {
        tags: {
          source: "spectator",
          puuid,
          region,
          httpStatus: httpStatus.toString(),
        },
      });
    }

    // A timeout, a 401, a 429, a network fault: the request did not come back
    // with an answer, so this call establishes nothing about the account.
    return {
      kind: "unavailable",
      upstream: false,
      reason:
        httpStatus === undefined
          ? "unreachable"
          : `http-${httpStatus.toString()}`,
    };
  }
}
