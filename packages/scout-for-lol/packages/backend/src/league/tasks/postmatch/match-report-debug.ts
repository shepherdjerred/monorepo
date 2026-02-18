import { z } from "zod";
import type {
  PlayerConfigEntry,
  MatchId,
  RawMatch,
} from "@scout-for-lol/data/index";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("postmatch-match-report-debug");

/**
 * Log detailed error information for debugging
 */
export function logErrorDetails(
  error: unknown,
  matchId: MatchId,
  matchData: RawMatch,
  trackedPlayers: PlayerConfigEntry[],
): void {
  // Extract error details using Zod validation
  const ErrorDetailsSchema = z.object({
    name: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
    cause: z.unknown().optional(),
  });
  const errorResult = ErrorDetailsSchema.safeParse(error);

  // Try to extract stack trace directly from error object (even if Zod validation fails)
  // Use a Zod schema to validate any object with a stack property
  const ObjectWithStackSchema = z.object({ stack: z.string() });
  let stackTrace: string | undefined;
  if (errorResult.success && errorResult.data.stack !== undefined && errorResult.data.stack.length > 0) {
    stackTrace = errorResult.data.stack;
  } else {
    const stackResult = ObjectWithStackSchema.safeParse(error);
    if (stackResult.success) {
      stackTrace = stackResult.data.stack;
    }
  }

  // Log basic error info
  logger.error(
    `[generateMatchReport] ❌ Error generating match report for ${matchId}`,
  );
  if (errorResult.success) {
    logger.error(
      `[generateMatchReport] ❌ Error name: ${errorResult.data.name ?? "Unknown"}`,
    );
    logger.error(
      `[generateMatchReport] ❌ Error message: ${errorResult.data.message}`,
    );
    if (errorResult.data.cause !== undefined && errorResult.data.cause !== null) {
      logger.error(
        `[generateMatchReport] ❌ Error cause:`,
        errorResult.data.cause,
      );
    }
  } else {
    logger.error(
      `[generateMatchReport] ❌ Error (non-standard format):`,
      error,
    );
  }

  // Always log stack trace if available
  if (stackTrace !== undefined && stackTrace.length > 0) {
    logger.error(`[generateMatchReport] ❌ Error stack trace:\n${stackTrace}`);
  } else {
    logger.error(`[generateMatchReport] ❌ No stack trace available`);
  }

  // Log match context
  logger.error(`[generateMatchReport] 📊 Match context:`);
  logger.error(`  - Match ID: ${matchId}`);
  logger.error(`  - Queue ID: ${matchData.info.queueId.toString()}`);
  logger.error(`  - Game Mode: ${matchData.info.gameMode}`);
  logger.error(`  - Game Type: ${matchData.info.gameType}`);
  logger.error(`  - Map ID: ${matchData.info.mapId.toString()}`);
  logger.error(
    `  - Participants: ${matchData.info.participants.length.toString()}`,
  );
  logger.error(`  - Game Duration: ${matchData.info.gameDuration.toString()}s`);
  logger.error(
    `  - Game Start: ${new Date(matchData.info.gameStartTimestamp).toISOString()}`,
  );

  // Log tracked players context
  logger.error(`[generateMatchReport] 👥 Tracked players context:`);
  logger.error(
    `  - Total tracked players: ${trackedPlayers.length.toString()}`,
  );
  logger.error(
    `  - Tracked player aliases: ${trackedPlayers.map((p) => p.alias).join(", ")}`,
  );
  logger.error(
    `  - Tracked player PUUIDs: ${trackedPlayers.map((p) => p.league.leagueAccount.puuid).join(", ")}`,
  );

  // Try to determine which step failed by checking if playersInMatch was computed
  try {
    const playersInMatch = trackedPlayers.filter((player) =>
      matchData.metadata.participants.includes(
        player.league.leagueAccount.puuid,
      ),
    );
    logger.error(`  - Players in match: ${playersInMatch.length.toString()}`);
    logger.error(
      `  - Players in match aliases: ${playersInMatch.map((p) => p.alias).join(", ")}`,
    );
  } catch (contextError) {
    logger.error(`  - Could not determine players in match:`, contextError);
  }

  // Log full error object as JSON for complex errors
  try {
    const errorJson = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error),
      2,
    );
    logger.error(`[generateMatchReport] ❌ Full error JSON:\n${errorJson}`);
  } catch (jsonError) {
    logger.error(
      `[generateMatchReport] ❌ Could not serialize error to JSON:`,
      jsonError,
    );
  }
}
