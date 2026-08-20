import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { returnCustomPlayersToLobby } from "#src/customs/voice-cleanup.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-result-voice");

export async function returnCustomResultPlayersToLobby(params: {
  snapshot: CustomNightSnapshot;
  nightId: string;
  source: "manual" | "riot";
}): Promise<void> {
  try {
    const failures = await returnCustomPlayersToLobby(params.snapshot);
    if (failures.length > 0) {
      logger.error("Custom result recorded with voice return failures", {
        failures,
        nightId: params.nightId,
        source: params.source,
      });
    }
  } catch (error) {
    logger.error("Custom result recorded but voice return failed", {
      error,
      nightId: params.nightId,
      source: params.source,
    });
  }
}
