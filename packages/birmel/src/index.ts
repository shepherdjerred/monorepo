import { getConfig } from "./config/index.js";
import {
  getDiscordClient,
  destroyDiscordClient,
  registerEventHandlers,
  setMessageHandler,
} from "./discord/index.js";
import { disconnectPrisma } from "./database/index.js";
import {
  getBirmelAgent,
  createBirmelAgentWithContext,
  startMastraServer,
} from "./mastra/index.js";
import {
  getMemory,
  getMemoryIds,
  type MemoryContext,
} from "./mastra/memory/index.js";
import { initializeMusicPlayer, destroyMusicPlayer } from "./music/index.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import {
  setVoiceCommandHandler,
  startCleanupTask,
  stopCleanupTask,
} from "./voice/index.js";
import { withTyping } from "./discord/utils/typing.js";
import { logger } from "./utils/index.js";
import { stylizeResponse, closePersonaDb } from "./persona/index.js";
import type { MessageContext } from "./discord/index.js";

/**
 * Fetch global working memory for a guild.
 * This contains server-wide rules like "don't do X".
 */
async function getGlobalMemoryContext(guildId: string): Promise<string | null> {
  try {
    const memory = getMemory();
    const memoryIds = getMemoryIds({ guildId, channelId: "", userId: "" });

    // Try to get the thread to access working memory
    const thread = await memory.getThreadById({
      threadId: memoryIds.global.threadId,
    });

    if (thread?.metadata?.["workingMemory"]) {
      return thread.metadata["workingMemory"] as string;
    }
    return null;
  } catch {
    // Thread doesn't exist yet, that's fine
    return null;
  }
}

async function handleMessage(context: MessageContext): Promise<void> {
  const config = getConfig();

  // STAGE 1: Create agent with decision context (persona's similar messages)
  const agent = config.persona.enabled
    ? createBirmelAgentWithContext(context.content)
    : getBirmelAgent();

  // Get memory IDs for three-tier system
  const memoryCtx: MemoryContext = {
    guildId: context.guildId,
    channelId: context.channelId,
    userId: context.userId,
  };
  const memoryIds = getMemoryIds(memoryCtx);

  // Fetch global memory (server rules) to inject into prompt
  const globalMemory = await getGlobalMemoryContext(context.guildId);
  const globalContext = globalMemory
    ? `\n## Server Rules & Memory\n${globalMemory}\n`
    : "";

  // Build prompt with context
  const prompt = `User ${context.username} (ID: ${context.userId}) in channel ${context.channelId} says:

${context.content}

Guild ID: ${context.guildId}
Channel ID: ${context.channelId}
${globalContext}`;

  try {
    // Show typing indicator while generating response
    // Use CHANNEL thread so all users share conversation context
    const response = await withTyping(context.message, async () => {
      return agent.generate(prompt, {
        threadId: memoryIds.channel.threadId,
        resourceId: memoryIds.channel.resourceId,
      });
    });

    // STAGE 2: Stylize response to match persona's voice
    let finalResponse = response.text;
    if (config.persona.enabled) {
      finalResponse = await stylizeResponse(
        response.text,
        config.persona.defaultPersona,
      );
    }

    // Send response back to Discord
    await context.message.reply(finalResponse);
  } catch (error) {
    logger.error("Agent generation failed", error);
    await context.message.reply(
      "Sorry, I encountered an error processing your request."
    );
  }
}

async function handleVoiceCommand(
  command: string,
  userId: string,
  guildId: string,
  channelId: string,
): Promise<string> {
  const config = getConfig();

  // STAGE 1: Create agent with decision context (persona's similar messages)
  const agent = config.persona.enabled
    ? createBirmelAgentWithContext(command)
    : getBirmelAgent();

  // Get memory IDs for three-tier system
  const memoryIds = getMemoryIds({ guildId, channelId, userId });

  // Fetch global memory (server rules) to inject into prompt
  const globalMemory = await getGlobalMemoryContext(guildId);
  const globalContext = globalMemory
    ? `\n## Server Rules & Memory\n${globalMemory}\n`
    : "";

  // Build prompt with voice context
  const prompt = `[VOICE COMMAND] User ID ${userId} in voice channel ${channelId} says:

${command}

Guild ID: ${guildId}
Channel ID: ${channelId}
${globalContext}
IMPORTANT: This is a voice command. Keep your response concise (under 200 words) as it will be spoken back via text-to-speech.`;

  try {
    const response = await agent.generate(prompt, {
      threadId: memoryIds.channel.threadId,
      resourceId: memoryIds.channel.resourceId,
    });

    // STAGE 2: Stylize response to match persona's voice
    let finalResponse = response.text;
    if (config.persona.enabled) {
      finalResponse = await stylizeResponse(
        response.text,
        config.persona.defaultPersona,
      );
    }

    return finalResponse;
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
  await disconnectPrisma();
  closePersonaDb();

  logger.info("Birmel shutdown complete");
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info("Starting Birmel...");

  // Validate config on startup
  const config = getConfig();
  logger.info("Configuration loaded", {
    model: config.openai.model,
    classifierModel: config.openai.classifierModel,
    voiceEnabled: config.voice.enabled,
    dailyPostsEnabled: config.dailyPosts.enabled,
    studioEnabled: config.mastra.studioEnabled,
    personaEnabled: config.persona.enabled,
    personaDefault: config.persona.defaultPersona,
  });

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

  // Start Mastra Studio server
  startMastraServer();

  // Handle graceful shutdown
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
