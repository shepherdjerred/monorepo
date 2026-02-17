// Initialize observability first - must be before other imports that might throw
import {
  initializeObservability,
  shutdownObservability,
  captureException,
} from "./observability/index.js";
initializeObservability();

import { getConfig } from "./config/index.js";
import {
  getDiscordClient,
  destroyDiscordClient,
  registerEventHandlers,
  setMessageHandler,
} from "./discord/index.js";
import { disconnectPrisma } from "./database/index.js";
import { handleMessageWithStreaming } from "./voltagent/message-handler.js";
import { initializeMusicPlayer, destroyMusicPlayer } from "./music/index.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import { startOAuthServer, stopOAuthServer } from "./editor/index.js";
import { logger } from "./utils/index.js";

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

main().catch(async (error: unknown) => {
  logger.error("Fatal error", error);
  if (error instanceof Error) {
    captureException(error, { operation: "main" });
  }
  await shutdownObservability();
  process.exit(1);
});
