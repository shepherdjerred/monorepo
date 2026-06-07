import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info("streambot configuration loaded", {
    guildId: config.discord.guildId,
    commandChannelId: config.discord.commandChannelId,
    videoChannelId: config.discord.videoChannelId,
    adminCount: config.discord.adminIds.length,
    videosDir: config.library.videosDir,
    mediaDirs: config.library.mediaDirs,
  });

  // The Discord command bot + selfbot streamer are wired here onto the playback machine.
  // (Added alongside the streamer/sources layers in this PR.)
  logger.warn("streambot Discord wiring not yet attached; core/config only");

  await Promise.resolve();
}

await main();
