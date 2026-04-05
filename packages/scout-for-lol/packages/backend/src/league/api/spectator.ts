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
 * Schema to detect a successful spectator response (has a `response` property)
 * vs a SpectatorNotAvailableDTO (has a `message` property, meaning player is not in game)
 */
const SpectatorSuccessSchema = z.object({
  response: z.unknown(),
});

/**
 * Fetch active game data for a player from the Spectator V5 API.
 *
 * @returns RawCurrentGameInfo if the player is in an active game, undefined otherwise
 */
export async function getActiveGame(
  puuid: LeaguePuuid,
  region: Region,
): Promise<RawCurrentGameInfo | undefined> {
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
      return undefined;
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
      return undefined;
    }

    logger.info(
      `[getActiveGame] ✅ ${puuid} is in game ${parseResult.data.gameId.toString()} (${parseResult.data.gameMode})`,
    );
    return parseResult.data;
  } catch (error) {
    riotApiRequestsTotal.inc({
      source: "spectator",
      status:
        error instanceof Error && error.message.includes("timed out")
          ? "timeout"
          : "error",
    });
    updateRiotApiHealth(false);

    const httpResult = z.object({ status: z.number() }).safeParse(error);
    if (httpResult.success) {
      const status = httpResult.data.status;
      logger.error(
        `[getActiveGame] ❌ HTTP Error ${status.toString()} for ${puuid}`,
      );
      riotApiErrorsTotal.inc({
        source: "spectator",
        http_status: status.toString(),
      });
      Sentry.captureException(error, {
        tags: {
          source: "spectator",
          puuid,
          region,
          httpStatus: status.toString(),
        },
      });
    } else {
      logger.error(
        `[getActiveGame] ❌ Error checking active game for ${puuid}:`,
        error,
      );
      riotApiErrorsTotal.inc({ source: "spectator", http_status: "unknown" });
    }

    return undefined;
  }
}
