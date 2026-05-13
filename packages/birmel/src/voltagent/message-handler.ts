import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { MessageContext } from "@shepherdjerred/birmel/discord/events/message-create.ts";
import { getRoutingAgent } from "./agents/routing-agent.ts";
import { createMessagingAgent } from "./agents/specialized/messaging-agent.ts";
import {
  getChannelConversationId,
  getServerWorkingMemory,
  getOwnerWorkingMemory,
} from "./memory/index.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import { buildPersonaPrompt } from "@shepherdjerred/birmel/persona/style-transform.ts";
import { buildMessageContent } from "@shepherdjerred/birmel/agent-tools/utils/message-builder.ts";
import { runWithRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { withConversationLock } from "@shepherdjerred/birmel/voltagent/conversation-lock.ts";
import {
  setSentryContext,
  clearSentryContext,
  captureException,
} from "@shepherdjerred/birmel/observability/sentry.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  TYPING_CURSOR,
  streamWithEmptyRetry,
  type StreamWithRetryResult,
} from "@shepherdjerred/birmel/voltagent/message-stream.ts";

// User-visible fallback when streamText resolves with zero text. This is
// the silent-typing-cursor case: a sub-agent reached `bail()` without
// producing any output (sub-agent tool threw, reasoning replay was poisoned
// by rapid concurrent turns on the same conversationId, etc.). Never
// silently delete the placeholder — surface the failure instead.
const EMPTY_STREAM_FALLBACK =
  "Sorry, I came back with nothing on that one — try again, maybe rephrase.";

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

    const conversationId = getChannelConversationId(context.channelId);

    // Serialize concurrent turns on the same channel — see conversation-lock.ts
    // for the GPT-5 reasoning-replay race that motivates this. Without it,
    // a user firing several pings back-to-back poisons the libSQL memory and
    // sub-agents start bailing with empty output.
    const streamResult: StreamWithRetryResult = await withConversationLock(
      conversationId,
      async () =>
        runWithRequestContext(
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
            return await streamWithEmptyRetry({
              routerAgent: agent,
              directMessagingAgentFactory: () =>
                createMessagingAgent(personaPrompt),
              input: inputStr,
              userId: context.userId,
              conversationId,
              placeholderMessage: placeholderMsg,
              requestId,
              persona,
            });
          },
        ),
    );

    // 9. Final edit removes cursor
    const genDuration = Date.now() - genStartTime;
    const accumulated = streamResult.text;
    logger.info("Streaming complete", {
      requestId,
      durationMs: genDuration,
      responseLength: accumulated.length,
      attempts: streamResult.attempts.map((attempt) => ({
        name: attempt.name,
        durationMs: attempt.durationMs,
        responseLength: attempt.text.length,
      })),
    });

    if (accumulated.length > 0) {
      try {
        await placeholderMsg.edit(accumulated);
      } catch (editError) {
        logger.debug("Failed to send final edit", { editError });
      }
    } else {
      // Stream resolved with no text — sub-agent bailed empty. Surface the
      // failure to the user and to Sentry/Bugsink so it stops being silent.
      logger.warn("empty stream result", {
        requestId,
        persona,
        conversationId,
        guildId: context.guildId,
        channelId: context.channelId,
        userId: context.userId,
        durationMs: genDuration,
      });
      captureException(new Error("streamText resolved with empty output"), {
        operation: "handleMessageWithStreaming",
        discord: discordContext,
        extra: {
          requestId,
          persona,
          emptyStream: true,
          durationMs: genDuration,
          attempts: streamResult.attempts.map((attempt) => ({
            name: attempt.name,
            durationMs: attempt.durationMs,
            responseLength: attempt.text.length,
          })),
        },
        fingerprint: ["birmel-empty-stream"],
      });
      try {
        await placeholderMsg.edit(EMPTY_STREAM_FALLBACK);
      } catch (editError) {
        logger.debug("Failed to edit empty-stream fallback", { editError });
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
