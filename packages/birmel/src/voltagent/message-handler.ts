import type { MessageContext } from "../discord/index.js";
import { createRoutingAgentWithPersona } from "./agents/routing-agent.js";
import {
  getServerWorkingMemory,
  getOwnerWorkingMemory,
  getChannelConversationId,
} from "./memory/index.js";
import { getGuildPersona, buildPersonaPrompt } from "../persona/index.js";
import { getRecentChannelMessages } from "../discord/utils/channel-history.js";
import { buildMessageContent } from "../mastra/utils/message-builder.js";
import { runWithRequestContext } from "../mastra/tools/request-context.js";
import {
  setSentryContext,
  clearSentryContext,
  captureException,
} from "../observability/index.js";
import { logger } from "../utils/index.js";

// Typing cursor for progressive updates
const TYPING_CURSOR = " \u258c";

// Minimum interval between Discord message edits (ms) to avoid rate limits
const EDIT_INTERVAL_MS = 1500;

// Minimum content length before showing in progressive update
const MIN_CONTENT_LENGTH = 20;

// Tool status messages for conversational feedback
const TOOL_STATUS_MESSAGES: Record<string, string> = {
  // Music tools
  "music-playback": "Finding and queueing that for you...",
  "music-queue": "Managing the queue...",
  // Discord tools
  "manage-message": "Sending message...",
  "manage-channel": "Configuring channel...",
  "manage-role": "Managing roles...",
  "manage-member": "Looking up member info...",
  "manage-server": "Checking server settings...",
  // Activity tools
  "get-activity-stats": "Checking activity stats...",
  "record-activity": "Recording activity...",
  // Memory tools
  "manage-memory": "Checking memory...",
  // Automation tools
  "manage-timer": "Setting up timer...",
  // Default
  default: "Working on it...",
};

function getToolStatusMessage(toolName: string): string {
  return TOOL_STATUS_MESSAGES[toolName] ?? TOOL_STATUS_MESSAGES.default;
}

/**
 * Handle a Discord message with VoltAgent streaming and progressive updates.
 */
export async function handleMessageWithStreaming(context: MessageContext): Promise<void> {
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
    if (serverMemory) {
      memoryContext += `\n## Server Memory (permanent)\n${serverMemory}\n`;
    }
    if (ownerMemory) {
      memoryContext += `\n## Owner Memory (${persona})\n${ownerMemory}\n`;
    }

    // 4. Build conversation history
    const conversationHistory = recentMessages.length > 0
      ? `\n## Recent Conversation\n${recentMessages.map(msg => `${msg.authorName}${msg.isBot ? " [BOT]" : ""}: ${msg.content}`).join("\n")}\n`
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

        const inputStr = typeof input === "string" ? input : JSON.stringify(input);
        const response = await agent.streamText(inputStr, {
          userId: context.userId,
          conversationId: getChannelConversationId(context.channelId),
        });

        // Track current tool status for conversational updates
        let currentToolStatus = "";
        let hasShownToolStatus = false;

        // Helper to process a text delta
        const processTextDelta = (text: string) => {
          accumulated += text;
          // Clear tool status once we start getting text
          if (currentToolStatus && hasShownToolStatus) {
            currentToolStatus = "";
          }
        };

        // Helper to process a tool call
        const processToolCall = (toolName: string) => {
          currentToolStatus = getToolStatusMessage(toolName);
          hasShownToolStatus = false;
          logger.debug("Tool call started", { toolName, accumulated: accumulated.length });
        };

        // Helper to update Discord message
        const maybeEditMessage = async () => {
          const now = Date.now();
          if (now - lastEditTime < EDIT_INTERVAL_MS) return;

          // Build display content: show tool status if no text yet
          let displayContent = accumulated;
          if (currentToolStatus && !hasShownToolStatus && accumulated.length < MIN_CONTENT_LENGTH) {
            displayContent = `*${currentToolStatus}*`;
            hasShownToolStatus = true;
          }

          if (displayContent.length >= MIN_CONTENT_LENGTH || (currentToolStatus && hasShownToolStatus)) {
            try {
              await placeholderMsg.edit(displayContent + TYPING_CURSOR);
              lastEditTime = now;
            } catch (editError) {
              logger.debug("Failed to edit placeholder message", { editError });
            }
          }
        };

        // Use fullStream to get tool events along with text
        for await (const part of response.fullStream) {
          if (part.type === "text-delta" && "textDelta" in part) {
            processTextDelta(part.textDelta as string);
          } else if (part.type === "tool-call" && "toolName" in part) {
            processToolCall(part.toolName);
          }
          await maybeEditMessage();
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
      `Sorry, I encountered an error processing your request.\n\`\`\`\n${errorMessage}\n\`\`\``
    );
  } finally {
    clearSentryContext();
  }
}

