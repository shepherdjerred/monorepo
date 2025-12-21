import type { Player } from "discord-player";
import { YoutubeiExtractor } from "discord-player-youtubei";
import { logger } from "../utils/index.js";

export async function registerExtractors(player: Player): Promise<void> {
  try {
    // Register YouTubei extractor (works without API key)
    await player.extractors.register(YoutubeiExtractor, {});
    logger.info("Registered YouTubei extractor");
  } catch (error) {
    logger.error("Failed to register extractors", error as Error);
  }
}
