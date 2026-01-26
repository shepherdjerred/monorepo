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
import { getMemory, getGlobalThreadId, getOwnerThreadId } from "./mastra/memory/index.js";
import { getGuildPersona } from "./persona/index.js";
import { initializeMusicPlayer, destroyMusicPlayer } from "./music/index.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import { startOAuthServer, stopOAuthServer } from "./editor/index.js";
import { withTyping } from "./discord/utils/typing.js";
import { logger } from "./utils/index.js";
import type { MessageContext } from "./discord/index.js";
import { buildMessageContent } from "./mastra/utils/message-builder.js";
import { getRecentChannelMessages } from "./discord/utils/channel-history.js";
import { runWithRequestContext } from "./mastra/tools/request-context.js";

/**
 * Fetch server working memory for a guild.
 * This contains permanent server-wide rules like "don't do X".
 */
async function getServerMemoryContext(guildId: string): Promise<string | null> {
  try {
    const memory = getMemory();
    const threadId = getGlobalThreadId(guildId);

    const thread = await memory.getThreadById({ threadId });

    if (thread?.metadata?.["workingMemory"]) {
      return thread.metadata["workingMemory"] as string;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch owner-specific working memory for a guild.
 * This contains current owner's preferences that switch when ownership changes.
 */
async function getOwnerMemoryContext(
  guildId: string,
): Promise<{ memory: string | null; persona: string }> {
  try {
    const persona = await getGuildPersona(guildId);
    const memory = getMemory();
    const threadId = getOwnerThreadId(guildId, persona);

    const thread = await memory.getThreadById({ threadId });

    return {
      memory: thread?.metadata?.["workingMemory"] as string | null ?? null,
      persona,
    };
  } catch {
    return { memory: null, persona: "default" };
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

    // Fetch both server and owner memory tiers
    logger.debug("Fetching memory tiers", { requestId, guildId: context.guildId });
    const [serverMemory, ownerResult] = await Promise.all([
      getServerMemoryContext(context.guildId),
      getOwnerMemoryContext(context.guildId),
    ]);

    // Build memory context sections
    let memoryContext = "";
    if (serverMemory) {
      memoryContext += `\n## Server Memory (permanent)\n${serverMemory}\n`;
      logger.debug("Server memory found", { requestId, memoryLength: serverMemory.length });
    }
    if (ownerResult.memory) {
      memoryContext += `\n## Owner Memory (${ownerResult.persona})\n${ownerResult.memory}\n`;
      logger.debug("Owner memory found", { requestId, persona: ownerResult.persona, memoryLength: ownerResult.memory.length });
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
${memoryContext}${conversationHistory}`;

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
  logger.info("Starting Birmel...");

  // Validate config on startup
  const config = getConfig();
  logger.info("Configuration loaded", {
    model: config.openai.model,
    classifierModel: config.openai.classifierModel,
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

  // Start scheduler after Discord is ready
  startScheduler();

  // Start Mastra Studio server
  await startMastraServer();

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
