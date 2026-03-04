import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { Player } from "discord-player";
import { YoutubeiExtractor } from "discord-player-youtubei";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

export async function registerExtractors(player: Player): Promise<void> {
  try {
    // Register YouTubei extractor with streamOptions to avoid signature decipher issues
    // eslint-disable-next-line custom-rules/no-type-assertions -- discord-player-youtubei types incompatible in Bazel sandbox symlink resolution
    await player.extractors.register(YoutubeiExtractor as unknown as Parameters<typeof player.extractors.register>[0], {
      streamOptions: {
        useClient: "ANDROID",
      },
    });
    logger.info("Registered YouTubei extractor");
  } catch (error) {
    logger.error("Failed to register extractors", toError(error));
  }
}
