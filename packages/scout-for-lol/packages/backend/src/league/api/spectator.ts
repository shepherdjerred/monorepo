import { z } from "zod";
import { api } from "#src/league/api/api.ts";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import type { Region, RawCurrentGameInfo } from "@scout-for-lol/data/index.ts";
import { RawCurrentGameInfoSchema } from "@scout-for-lol/data/index.ts";
import type { LeaguePuuid } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  riotApiErrorsTotal,
  riotApiRequestsTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("spectator-api");

/**
 * HTTP status codes from the Riot API that indicate a temporary upstream
 * outage. These are expected during maintenance windows and should not be
 * retried or reported as unexpected errors.
 */
const EXPECTED_UPSTREAM_ERROR_STATUSES = new Set([502, 503]);

/**
 * Result of a spectator API call. The `upstreamError` flag lets callers
 * distinguish "player not in game" from "Riot API is down" so they can
 * engage a circuit breaker without re-inspecting the HTTP status.
 */
export type SpectatorResult = {
  /** Active game data, or undefined if the player is not in a game / API errored */
  game: RawCurrentGameInfo | undefined;
  /** True when the API returned an expected upstream error (502/503) */
  upstreamError: boolean;
};

/**
 * Schema to detect a successful spectator response (has a `response` property)
 * vs a SpectatorNotAvailableDTO (has a `message` property, meaning player is not in game)
 */
const SpectatorSuccessSchema = z.object({
  response: z.unknown(),
});

/**
 * Fetch active game data for a player from the Spectator V5 API.
 *
 * @returns A SpectatorResult containing the game data (if any) and whether
 *          the request failed due to an expected upstream error.
 */
export async function getActiveGame(
  puuid: LeaguePuuid,
  region: Region,
): Promise<SpectatorResult> {
  try {
    const twistedRegion = mapRegionToEnum(region);

    Sentry.addBreadcrumb({
      category: "riot-api",
      message: `Checking active game for ${puuid}`,
      data: { puuid, region, endpoint: "SpectatorV5.activeGame" },
      level: "info",
    });

    logger.info(`[getActiveGame] 🔍 Checking active game for ${puuid}`);
    const result = await withTimeout(
      api.SpectatorV5.activeGame(puuid, twistedRegion),
    );

    // twisted returns { response: CurrentGameInfoDTO } on success
    // or { message: "No active game found" } on 404
    const successResult = SpectatorSuccessSchema.safeParse(result);
    if (!successResult.success) {
      // Player is not in a game (SpectatorNotAvailableDTO)
      riotApiRequestsTotal.inc({ source: "spectator", status: "not_in_game" });
      updateRiotApiHealth(true);
      logger.info(`[getActiveGame] ℹ️  ${puuid} is not in a game`);
      return { game: undefined, upstreamError: false };
    }

    riotApiRequestsTotal.inc({ source: "spectator", status: "success" });
    updateRiotApiHealth(true);

    // Validate the response against our schema
    const parseResult = RawCurrentGameInfoSchema.safeParse(
      successResult.data.response,
    );
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
      return { game: undefined, upstreamError: false };
    }

    logger.info(
      `[getActiveGame] ✅ ${puuid} is in game ${parseResult.data.gameId.toString()} (${parseResult.data.gameMode})`,
    );
    return { game: parseResult.data, upstreamError: false };
  } catch (error: unknown) {
    // 404 = player not in a game — expected/normal case
    // twisted's GenericError sets `status` from the HTTP response.
    // Use z.coerce.number() to handle both number (404) and string ("404") status values,
    // since twisted's error shape is not guaranteed.
    const httpStatusResult = z
      .object({ status: z.coerce.number().int() })
      .safeParse(error);
    const httpStatus = httpStatusResult.success
      ? httpStatusResult.data.status
      : undefined;

    if (httpStatus === 404) {
      riotApiRequestsTotal.inc({ source: "spectator", status: "not_found" });
      updateRiotApiHealth(true);
      logger.debug(`[getActiveGame] Player ${puuid} not in game`);
      return { game: undefined, upstreamError: false };
    }

    // 502/503 = Riot upstream outage — expected during maintenance windows.
    // Do NOT report to Sentry here; the caller's circuit breaker handles
    // rate-limited reporting. Just log at warn level and signal upstreamError.
    if (
      httpStatus !== undefined &&
      EXPECTED_UPSTREAM_ERROR_STATUSES.has(httpStatus)
    ) {
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
      return { game: undefined, upstreamError: true };
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

    return { game: undefined, upstreamError: false };
  }
}
