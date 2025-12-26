// Initialize observability first - must be before other imports that might throw
import {
  initializeObservability,
  shutdownObservability,
  setSentryContext,
  clearSentryContext,
  captureException,
} from "./observability/index.js";
initializeObservability();

import { getOrCreateSpan, SpanType } from "@mastra/core/observability";
import { getConfig } from "./config/index.js";
import {
  getDiscordClient,
  destroyDiscordClient,
  registerEventHandlers,
  setMessageHandler,
} from "./discord/index.js";
import { disconnectPrisma } from "./database/index.js";
import {
  mastra,
  routingAgent,
  startMastraServer,
} from "./mastra/index.js";
import { getMemory, getGlobalThreadId } from "./mastra/memory/index.js";
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
import { getGuildPersona } from "./persona/guild-persona.js";
import type { MessageContext } from "./discord/index.js";
import { buildMessageContent } from "./mastra/utils/message-builder.js";
import { getRecentChannelMessages } from "./discord/utils/channel-history.js";
import { runWithRequestContext } from "./mastra/tools/request-context.js";

/**
 * Fetch global working memory for a guild.
 * This contains server-wide rules like "don't do X".
 */
async function getGlobalMemoryContext(guildId: string): Promise<string | null> {
  try {
    const memory = getMemory();
    const threadId = getGlobalThreadId(guildId);

    // Try to get the thread to access working memory
    const thread = await memory.getThreadById({
      threadId,
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
  const discordContext = {
    guildId: context.guildId,
    channelId: context.channelId,
    userId: context.userId,
    username: context.username,
    messageId: context.message.id,
  };

  // Set Sentry context for this request
  setSentryContext(discordContext);

  const startTime = Date.now();
  const requestId = `msg-${context.message.id.slice(-8)}`;

  // Create a Mastra span for the entire message handling
  const messageSpan = getOrCreateSpan({
    type: SpanType.GENERIC,
    name: "discord.message.handle",
    mastra,
    metadata: {
      ...discordContext,
      requestId,
    },
    input: { content: context.content.slice(0, 500) },
  });

  try {
    logger.info("Handling message", {
      requestId,
      guildId: context.guildId,
      channelId: context.channelId,
      userId: context.userId,
      username: context.username,
      contentLength: context.content.length,
    });

    // Fetch global memory (server rules) to inject into prompt
    logger.debug("Fetching global memory", { requestId, guildId: context.guildId });
    const globalMemory = await getGlobalMemoryContext(context.guildId);
    const globalContext = globalMemory
      ? `\n## Server Rules & Memory\n${globalMemory}\n`
      : "";

    if (globalMemory) {
      logger.debug("Global memory found", { requestId, memoryLength: globalMemory.length });
    }

    // Fetch recent Discord messages for conversational context
    const recentMessages = await getRecentChannelMessages(context.message, 20);
    const conversationHistory = recentMessages.length > 0
      ? `\n## Recent Conversation\n${recentMessages.map(msg => `${msg.authorName}${msg.isBot ? " [BOT]" : ""}: ${msg.content}`).join("\n")}\n`
      : "";

    // Build prompt with context
    const prompt = `User ${context.username} (ID: ${context.userId}) in channel ${context.channelId} says:

${context.content}

${context.attachments.length > 0 ? `[User attached ${String(context.attachments.length)} image(s)]` : ""}

Guild ID: ${context.guildId}
Channel ID: ${context.channelId}
${globalContext}${conversationHistory}`;

    // Show typing indicator while generating response via Agent Network
    // The routing agent coordinates specialized sub-agents (messaging, server, moderation, music, automation)
    logger.debug("Generating response via Agent Network", { requestId, hasImages: context.attachments.length > 0, recentMessageCount: recentMessages.length });
    const genStartTime = Date.now();

    // Build multimodal content if images present
    const messageContent = await buildMessageContent(context, prompt);

    // Wrap multimodal content in a message object with role
    const messageInput = Array.isArray(messageContent)
      ? { role: "user" as const, content: messageContent }
      : messageContent;

    // Use Agent Network - routing agent delegates to specialized sub-agents
    // Wrap with request context so tools can access source message for replies
    let responseText = "";
    await runWithRequestContext(
      {
        sourceChannelId: context.channelId,
        sourceMessageId: context.message.id,
        guildId: context.guildId,
        userId: context.userId,
      },
      async () => {
        return withTyping(context.message, async () => {
          // Pass tracingContext to network so spans are linked
          const networkStream = await routingAgent.network(messageInput, {
            ...(messageSpan ? { tracingContext: { currentSpan: messageSpan } } : {}),
            runId: requestId,
          });

          // Process the network stream to get the final result
          for await (const chunk of networkStream) {
            // Extract the final response from network execution events
            // NetworkStepFinishPayload has result as string directly
            if (chunk.type === "network-execution-event-step-finish" && chunk.payload.result) {
              responseText = chunk.payload.result;
            }
          }
        });
      },
    );

    const genDuration = Date.now() - genStartTime;

    // Agent is responsible for sending messages via tools
    // Log the final response text for debugging (not sent automatically)
    logger.info("Agent network completed", {
      requestId,
      durationMs: genDuration,
      responseTextLength: responseText.length,
      responseTextPreview: responseText.slice(0, 200),
    });

    const totalDuration = Date.now() - startTime;
    logger.info("Message handled successfully", {
      requestId,
      totalDurationMs: totalDuration,
      generationDurationMs: genDuration,
    });

    messageSpan?.end({
      output: { responseLength: responseText.length, durationMs: totalDuration },
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    logger.error("Agent generation failed", error, {
      requestId,
      totalDurationMs: totalDuration,
    });
    captureException(error as Error, {
      operation: "handleMessage",
      discord: discordContext,
      extra: { requestId },
    });

    messageSpan?.error({
      error: error instanceof Error ? error : new Error(String(error)),
      endSpan: true,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    await context.message.reply(
      `Sorry, I encountered an error processing your request.\n\`\`\`\n${errorMessage}\n\`\`\``
    );
  } finally {
    clearSentryContext();
  }
}

async function handleVoiceCommand(
  command: string,
  userId: string,
  guildId: string,
  channelId: string,
): Promise<string> {
  const discordContext = {
    guildId,
    channelId,
    userId,
  };

  setSentryContext(discordContext);

  const startTime = Date.now();
  const requestId = `voice-${Date.now().toString(36)}`;

  // Create a Mastra span for the voice command handling
  const voiceSpan = getOrCreateSpan({
    type: SpanType.GENERIC,
    name: "discord.voice.command",
    mastra,
    metadata: {
      ...discordContext,
      requestId,
    },
    input: { command: command.slice(0, 200) },
  });

  try {
    logger.info("Handling voice command", {
      requestId,
      guildId,
      channelId,
      userId,
      commandLength: command.length,
      commandPreview: command.slice(0, 50),
    });

    const config = getConfig();

    // Fetch global memory (server rules) to inject into prompt
    logger.debug("Fetching global memory for voice", { requestId, guildId });
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

    logger.debug("Generating voice response via Agent Network", { requestId });
    const genStartTime = Date.now();

    // Use Agent Network for voice commands
    // Wrap with request context (no sourceMessageId for voice - can't reply)
    let responseText = "";
    await runWithRequestContext(
      {
        sourceChannelId: channelId,
        sourceMessageId: "", // Voice commands can't use reply action
        guildId,
        userId,
      },
      async () => {
        // Pass tracingContext to network so spans are linked
        const networkStream = await routingAgent.network(prompt, {
          ...(voiceSpan ? { tracingContext: { currentSpan: voiceSpan } } : {}),
          runId: requestId,
        });

        // Process the network stream to get the final result
        for await (const chunk of networkStream) {
          // NetworkStepFinishPayload has result as string directly
          if (chunk.type === "network-execution-event-step-finish" && chunk.payload.result) {
            responseText = chunk.payload.result;
          }
        }
      },
    );

    const genDuration = Date.now() - genStartTime;
    logger.debug("Voice response generated via Agent Network", {
      requestId,
      durationMs: genDuration,
      responseLength: responseText.length,
    });

    // STAGE 2: Stylize response to match persona's voice
    let finalResponse = responseText;
    if (config.persona.enabled) {
      const persona = await getGuildPersona(guildId);
      logger.debug("Stylizing voice response", { requestId, persona });
      finalResponse = await stylizeResponse(responseText, persona);
    }

    const totalDuration = Date.now() - startTime;
    logger.info("Voice command handled successfully", {
      requestId,
      totalDurationMs: totalDuration,
      generationDurationMs: genDuration,
      responseLength: finalResponse.length,
    });

    voiceSpan?.end({
      output: { responseLength: finalResponse.length, durationMs: totalDuration },
    });

    return finalResponse;
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    logger.error("Voice command agent generation failed", error, {
      requestId,
      totalDurationMs: totalDuration,
    });
    captureException(error as Error, {
      operation: "handleVoiceCommand",
      discord: discordContext,
      extra: { requestId },
    });

    voiceSpan?.error({
      error: error instanceof Error ? error : new Error(String(error)),
      endSpan: true,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Sorry, I encountered an error processing your voice command.\n\`\`\`\n${errorMessage}\n\`\`\``;
  } finally {
    clearSentryContext();
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

  // Shutdown observability last to capture any final events
  await shutdownObservability();

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
    sentryEnabled: config.sentry.enabled,
    telemetryEnabled: config.telemetry.enabled,
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
  await startMastraServer();

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
