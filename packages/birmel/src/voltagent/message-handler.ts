import type { MessageContext } from "@shepherdjerred/birmel/discord/index.ts";
import { createRoutingAgentWithPersona } from "./agents/routing-agent.ts";
import {
  getServerWorkingMemory,
  getOwnerWorkingMemory,
  getChannelConversationId,
} from "./memory/index.ts";
import { getGuildPersona, buildPersonaPrompt } from "@shepherdjerred/birmel/persona/index.ts";
import { getRecentChannelMessages } from "@shepherdjerred/birmel/discord/utils/channel-history.ts";
import { buildMessageContent } from "@shepherdjerred/birmel/mastra/utils/message-builder.ts";
import { runWithRequestContext } from "@shepherdjerred/birmel/mastra/tools/request-context.ts";
import {
  setSentryContext,
  clearSentryContext,
  captureException,
} from "@shepherdjerred/birmel/observability/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/index.ts";

// Typing cursor for progressive updates
const TYPING_CURSOR = " \u258C";

// Minimum interval between Discord message edits (ms) to avoid rate limits
const EDIT_INTERVAL_MS = 1500;

// Minimum content length before showing in progressive update
const MIN_CONTENT_LENGTH = 20;

/**
 * Handle a Discord message with VoltAgent streaming and progressive updates.
 */
export async function handleMessageWithStreaming(
  context: MessageContext,
): Promise<void> {
  const discordContext = {
    guildId: context.guildId,
    channelId: context.channelId,
    userId: context.userId,
    username: context.username,
    messageId: context.message.id,
  };

  setSentryContext(discordContext);

  const startTime = Date.now();
  const requestId = `msg-${context.message.id.slice(-8)}`;

  try {
    logger.info("Handling message with streaming", {
      requestId,
      guildId: context.guildId,
      channelId: context.channelId,
      userId: context.userId,
      username: context.username,
      contentLength: context.content.length,
    });

    // 1. Send immediate placeholder with typing cursor
    const placeholderMsg = await context.message.reply(TYPING_CURSOR.trim());

    // 2. Fetch persona and memory context in parallel
    const persona = await getGuildPersona(context.guildId);
    const [serverMemory, ownerMemory, recentMessages] = await Promise.all([
      getServerWorkingMemory(context.guildId),
      getOwnerWorkingMemory(context.guildId, persona),
      getRecentChannelMessages(context.message, 20),
    ]);

    // 3. Build memory context sections
    let memoryContext = "";
    if (serverMemory != null && serverMemory.length > 0) {
      memoryContext += `\n## Server Memory (permanent)\n${serverMemory}\n`;
    }
    if (ownerMemory != null && ownerMemory.length > 0) {
      memoryContext += `\n## Owner Memory (${persona})\n${ownerMemory}\n`;
    }

    // 4. Build conversation history
    const conversationHistory =
      recentMessages.length > 0
        ? `\n## Recent Conversation\n${recentMessages.map((msg) => `${msg.authorName}${msg.isBot ? " [BOT]" : ""}: ${msg.content}`).join("\n")}\n`
        : "";

    // 5. Build prompt with context
    const prompt = `User ${context.username} (ID: ${context.userId}) in channel ${context.channelId} says:

${context.content}

${context.attachments.length > 0 ? `[User attached ${String(context.attachments.length)} image(s)]` : ""}

Guild ID: ${context.guildId}
Channel ID: ${context.channelId}
${memoryContext}${conversationHistory}`;

    // 6. Build multimodal content if images present
    const messageContent = await buildMessageContent(context, prompt);

    // 7. Create agent with persona-embedded instructions
    const personaPrompt = buildPersonaPrompt(persona);
    const agent = createRoutingAgentWithPersona(personaPrompt);

    // 8. Stream response with progressive Discord updates
    logger.debug("Starting streaming response", { requestId, persona });
    const genStartTime = Date.now();

    let accumulated = "";
    let lastEditTime = Date.now();

    await runWithRequestContext(
      {
        sourceChannelId: context.channelId,
        sourceMessageId: context.message.id,
        guildId: context.guildId,
        userId: context.userId,
      },
      async () => {
        // Wrap multimodal content in a message object with role
        const input = Array.isArray(messageContent)
          ? { role: "user" as const, content: messageContent }
          : messageContent;

        const inputStr =
          typeof input === "string" ? input : JSON.stringify(input);
        const response = await agent.streamText(inputStr, {
          userId: context.userId,
          conversationId: getChannelConversationId(context.channelId),
        });

        // Process the text stream with progressive edits
        for await (const chunk of response.textStream) {
          accumulated += chunk;

          // Edit every EDIT_INTERVAL_MS to avoid rate limits
          const now = Date.now();
          if (
            now - lastEditTime >= EDIT_INTERVAL_MS &&
            accumulated.length >= MIN_CONTENT_LENGTH
          ) {
            try {
              await placeholderMsg.edit(accumulated + TYPING_CURSOR);
              lastEditTime = now;
            } catch (editError) {
              // If edit fails (e.g., message deleted), log and continue
              logger.debug("Failed to edit placeholder message", { editError });
            }
          }
        }
      },
    );

    // 9. Final edit removes cursor
    const genDuration = Date.now() - genStartTime;
    logger.info("Streaming complete", {
      requestId,
      durationMs: genDuration,
      responseLength: accumulated.length,
    });

    if (accumulated.length > 0) {
      try {
        await placeholderMsg.edit(accumulated);
      } catch (editError) {
        logger.debug("Failed to send final edit", { editError });
      }
    } else {
      // If no content was generated, remove the placeholder
      try {
        await placeholderMsg.delete();
      } catch {
        // Ignore delete errors
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info("Message handled successfully", {
      requestId,
      totalDurationMs: totalDuration,
      generationDurationMs: genDuration,
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    logger.error("Streaming generation failed", error, {
      requestId,
      totalDurationMs: totalDuration,
    });
    captureException(error as Error, {
      operation: "handleMessageWithStreaming",
      discord: discordContext,
      extra: { requestId },
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    await context.message.reply(
      `Sorry, I encountered an error processing your request.\n\`\`\`\n${errorMessage}\n\`\`\``,
    );
  } finally {
    clearSentryContext();
  }
}
