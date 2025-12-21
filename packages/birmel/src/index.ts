import { getConfig } from "./config/index.js";
import {
  getDiscordClient,
  destroyDiscordClient,
  registerEventHandlers,
  setMessageHandler,
} from "./discord/index.js";
import { getDatabase, closeDatabase } from "./database/index.js";
import { getBirmelAgent } from "./mastra/index.js";
import { initializeMusicPlayer, destroyMusicPlayer } from "./music/index.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import {
  setVoiceCommandHandler,
  startCleanupTask,
  stopCleanupTask,
} from "./voice/index.js";
import { logger } from "./utils/index.js";
import type { MessageContext } from "./discord/index.js";

async function handleMessage(context: MessageContext): Promise<void> {
  const agent = getBirmelAgent();

  // Build prompt with context
  const prompt = `User ${context.username} (ID: ${context.userId}) in channel ${context.channelId} says:

${context.content}

Guild ID: ${context.guildId}
Channel ID: ${context.channelId}`;

  try {
    const response = await agent.generate(prompt);

    // Send response back to Discord
    await context.message.reply(response.text);
  } catch (error) {
    logger.error("Agent generation failed", error);
    await context.message.reply(
      "Sorry, I encountered an error processing your request.",
    );
  }
}

async function handleVoiceCommand(
  command: string,
  userId: string,
  guildId: string,
  channelId: string,
): Promise<string> {
  const agent = getBirmelAgent();

  // Build prompt with voice context
  const prompt = `[VOICE COMMAND] User ID ${userId} in voice channel ${channelId} says:

${command}

Guild ID: ${guildId}
Channel ID: ${channelId}

IMPORTANT: This is a voice command. Keep your response concise (under 200 words) as it will be spoken back via text-to-speech.`;

  try {
    const response = await agent.generate(prompt);
    return response.text;
  } catch (error) {
    logger.error("Voice command agent generation failed", error);
    return "Sorry, I encountered an error processing your voice command.";
  }
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down Birmel...");

  stopCleanupTask();
  stopScheduler();
  await destroyMusicPlayer();
  await destroyDiscordClient();
  closeDatabase();

  logger.info("Birmel shutdown complete");
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info("Starting Birmel...");

  // Validate config on startup
  const config = getConfig();
  logger.info("Configuration loaded", {
    model: config.anthropic.model,
    voiceEnabled: config.voice.enabled,
    dailyPostsEnabled: config.dailyPosts.enabled,
  });

  // Initialize database (runs migrations)
  getDatabase();
  logger.info("Database initialized");

  // Set up Discord client
  const client = getDiscordClient();
  registerEventHandlers(client);
  setMessageHandler(handleMessage);

  // Login to Discord
  await client.login(config.discord.token);

  // Initialize music player
  await initializeMusicPlayer();
  logger.info("Music player initialized");

  // Set up voice command handler
  if (config.voice.enabled) {
    setVoiceCommandHandler(handleVoiceCommand);
    startCleanupTask();
    logger.info("Voice command handler initialized");
  }

  // Start scheduler after Discord is ready
  startScheduler();

  // Handle graceful shutdown
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
