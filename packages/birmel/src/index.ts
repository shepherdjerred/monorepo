// Initialize observability first - must be before other imports that might throw
import {
  initializeObservability,
  shutdownObservability,
} from "./observability/index.ts";
initializeObservability();

import { captureException } from "./observability/sentry.ts";
import { getConfig } from "./config/index.ts";
import { getDiscordClient, destroyDiscordClient } from "./discord/client.ts";
import { registerEventHandlers } from "./discord/events/index.ts";
import { setMessageHandler } from "./discord/events/message-create.ts";
import { disconnectPrisma } from "./database/index.ts";
import { handleMessageWithStreaming } from "./voltagent/message-handler.ts";
import { initializeMusicPlayer, destroyMusicPlayer } from "./music/player.ts";
import { startScheduler, stopScheduler } from "./scheduler/index.ts";
import { startOAuthServer, stopOAuthServer } from "./editor/oauth-server.ts";
import { logger } from "./utils/logger.ts";

async function shutdown(): Promise<void> {
  logger.info("Shutting down Birmel...");

  stopScheduler();
  await stopOAuthServer();
  await destroyMusicPlayer();
  await destroyDiscordClient();
  await disconnectPrisma();

  // Shutdown observability last to capture any final events
  await shutdownObservability();

  logger.info("Birmel shutdown complete");
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info("Starting Birmel (VoltAgent)...");

  // Validate config on startup
  const config = getConfig();
  logger.info("Configuration loaded", {
    model: config.openai.model,
    classifierModel: config.openai.classifierModel,
    dailyPostsEnabled: config.dailyPosts.enabled,
    personaEnabled: config.persona.enabled,
    personaDefault: config.persona.defaultPersona,
    sentryEnabled: config.sentry.enabled,
    telemetryEnabled: config.telemetry.enabled,
  });

  // Set up Discord client
  const client = getDiscordClient();
  registerEventHandlers(client);

  // Use VoltAgent streaming message handler
  setMessageHandler(handleMessageWithStreaming);

  // Login to Discord
  await client.login(config.discord.token);

  // Initialize music player
  await initializeMusicPlayer();
  logger.info("Music player initialized");

  // Start scheduler after Discord is ready
  startScheduler();

  // Start OAuth server for GitHub authentication (exposed via Tailscale Funnel)
  await startOAuthServer();

  // Handle graceful shutdown
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

try {
  await main();
} catch (error: unknown) {
  logger.error("Fatal error", error);
  if (error instanceof Error) {
    captureException(error, { operation: "main" });
  }
  await shutdownObservability();
  process.exit(1);
}
