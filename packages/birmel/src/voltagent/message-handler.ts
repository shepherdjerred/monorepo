import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { MessageContext } from "@shepherdjerred/birmel/discord/events/message-create.ts";
import { getRoutingAgent } from "./agents/routing-agent.ts";
import {
  getChannelConversationId,
  getServerWorkingMemory,
  getOwnerWorkingMemory,
} from "./memory/index.ts";
import { OPENAI_RESPONSES_PROVIDER_OPTIONS } from "@shepherdjerred/birmel/voltagent/openai-provider-options.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import { buildPersonaPrompt } from "@shepherdjerred/birmel/persona/style-transform.ts";
import { buildMessageContent } from "@shepherdjerred/birmel/agent-tools/utils/message-builder.ts";
import { runWithRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import {
  setSentryContext,
  clearSentryContext,
  captureException,
} from "@shepherdjerred/birmel/observability/sentry.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

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

    // 2. Fetch persona and working-memory context in parallel.
    //
    // We deliberately do NOT fetch recent channel messages here — VoltAgent's
    // memory layer auto-loads conversation history via the `conversationId`
    // we pass to streamText, so manually injecting a Discord-API-fetched
    // transcript would duplicate context, waste tokens, and risk drift.
    const persona = await getGuildPersona(context.guildId);
    const [serverMemory, ownerMemory] = await Promise.all([
      getServerWorkingMemory(context.guildId),
      getOwnerWorkingMemory(context.guildId, persona),
    ]);

    // 3. Build memory context sections (working memory only — these are
    //    durable user-defined rules/preferences, distinct from per-turn
    //    conversation history).
    let memoryContext = "";
    if (serverMemory != null && serverMemory.length > 0) {
      memoryContext += `\n## Server Memory (permanent)\n${serverMemory}\n`;
    }
    if (ownerMemory != null && ownerMemory.length > 0) {
      memoryContext += `\n## Owner Memory (${persona})\n${ownerMemory}\n`;
    }

    // 4. Build prompt with context
    const prompt = `User ${context.username} (ID: ${context.userId}) in channel ${context.channelId} says:

${context.content}

${context.attachments.length > 0 ? `[User attached ${String(context.attachments.length)} image(s)]` : ""}

Guild ID: ${context.guildId}
Channel ID: ${context.channelId}
${memoryContext}`;

    // 5. Build multimodal content if images present
    const messageContent = await buildMessageContent(context, prompt);

    // 6. Get a routing agent for this persona (cached per persona).
    const personaPrompt = await buildPersonaPrompt(persona);
    const agent = getRoutingAgent(personaPrompt);

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
          // OpenAI Responses options applied at every layer — see
          // openai-provider-options.ts for why store:false + reasoning include
          // is required for GPT-5 reasoning replay correctness.
          providerOptions: OPENAI_RESPONSES_PROVIDER_OPTIONS,
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
    captureException(toError(error), {
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
