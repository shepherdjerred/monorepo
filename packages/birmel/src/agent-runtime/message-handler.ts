import type { Message } from "discord.js";
import {
  admitAgentRun,
  completeAgentRun,
  failAgentRun,
  recordAgentRunContext,
  recordAgentRunRoute,
  suppressQueuedSessionAgentRun,
} from "@shepherdjerred/birmel/agent-runtime/agent-runs.ts";
import { extractAndApplyTurnMemory } from "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts";
import { executeRoutedTurn } from "@shepherdjerred/birmel/agent-runtime/runtime.ts";
import { routeTurn } from "@shepherdjerred/birmel/agent-runtime/router.ts";
import { withTurnQueue } from "@shepherdjerred/birmel/agent-runtime/turn-queue.ts";
import {
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { buildContextForTurn } from "@shepherdjerred/birmel/context/turn-context.ts";
import type { MessageContext } from "@shepherdjerred/birmel/discord/events/message-create.ts";
import { markEngaged } from "@shepherdjerred/birmel/discord/engagement-tracker.ts";
import { getConversationTranscriptResult } from "@shepherdjerred/birmel/discord/utils/channel-history.ts";
import {
  captureException,
  clearSentryContext,
  setSentryContext,
  type DiscordContext,
} from "@shepherdjerred/birmel/observability/sentry.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import {
  appendSessionEvent,
  isSessionActiveForThread,
} from "@shepherdjerred/birmel/sessions/service.ts";
import { summarizeSessionIfNeeded } from "@shepherdjerred/birmel/sessions/summarization.ts";
import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

const PLACEHOLDER = "…";
const MAX_DISCORD_RESPONSE_CHARACTERS = 2000;

type PostDeliveryOperation =
  | "agent-run.complete"
  | "session.events"
  | "turn.post-delivery";

function incidentId(): string {
  return `B3-${crypto.randomUUID().slice(0, 8)}`;
}

function validateResponse(value: string): string {
  if (value.trim().length === 0) {
    throw new Error("Agent returned an empty response");
  }
  if (value.length > MAX_DISCORD_RESPONSE_CHARACTERS) {
    throw new Error("Agent response exceeded Discord's 2000-character limit");
  }
  return value;
}

async function withDiscordDelivery<T>(options: {
  context: MessageContext;
  phase: "placeholder" | "final" | "incident";
  operation: () => Promise<T>;
}): Promise<T> {
  return await withSpan(
    "birmel.discord.delivery",
    {
      guildId: options.context.turn.guildId,
      channelId: options.context.turn.channelId,
      userId: options.context.turn.userId,
      messageId: options.context.turn.discordMessageId,
      operation: `discord.delivery.${options.phase}`,
    },
    async (span) => {
      const startedAt = performance.now();
      try {
        const delivered = await options.operation();
        span.setAttribute("birmel.discord.delivery_success", true);
        span.setAttribute(
          "birmel.discord.delivery_duration_ms",
          performance.now() - startedAt,
        );
        logger.info("Discord response delivery completed", {
          messageId: options.context.turn.discordMessageId,
          channelId: options.context.turn.channelId,
          phase: options.phase,
        });
        return delivered;
      } catch (error) {
        span.setAttribute("birmel.discord.delivery_success", false);
        span.setAttribute(
          "birmel.discord.delivery_error_class",
          error instanceof Error ? error.name : "UnknownError",
        );
        throw error;
      }
    },
  );
}

async function appendCompletedSessionEvents(options: {
  sessionId: string;
  response: string;
  responseMessageId: string;
  toolEvents: { toolId: string; content: string }[];
}): Promise<void> {
  for (const event of options.toolEvents) {
    await appendSessionEvent({
      sessionId: options.sessionId,
      role: "tool",
      eventType: "tool-summary",
      content: event.content,
      toolId: event.toolId,
    });
  }
  await appendSessionEvent({
    sessionId: options.sessionId,
    role: "assistant",
    eventType: "message",
    content: options.response,
    discordMessageId: options.responseMessageId,
  });
  await summarizeSessionIfNeeded(options.sessionId);
}

function reportPostDeliveryPersistenceFailure(options: {
  error: unknown;
  operation: PostDeliveryOperation;
  runId: string;
  messageId: string;
  discordContext: DiscordContext;
}): void {
  const errorClass =
    options.error instanceof Error ? options.error.name : "UnknownError";
  logger.error("Post-delivery persistence failed", options.error, {
    runId: options.runId,
    messageId: options.messageId,
    operation: options.operation,
    errorClass,
  });
  captureException(toError(options.error), {
    operation: options.operation,
    discord: options.discordContext,
    extra: { runId: options.runId, errorClass },
  });
}

async function persistDeliveredTurn(options: {
  context: MessageContext;
  runId: string;
  response: string;
  responseMessageId: string;
  execution: Awaited<ReturnType<typeof executeRoutedTurn>>;
  discordContext: DiscordContext;
}): Promise<void> {
  if (options.context.activeSessionId != null) {
    try {
      await appendCompletedSessionEvents({
        sessionId: options.context.activeSessionId,
        response: options.response,
        responseMessageId: options.responseMessageId,
        toolEvents: options.execution.toolEvents,
      });
    } catch (error) {
      reportPostDeliveryPersistenceFailure({
        error,
        operation: "session.events",
        runId: options.runId,
        messageId: options.context.turn.discordMessageId,
        discordContext: options.discordContext,
      });
    }
  }

  try {
    await completeAgentRun({
      runId: options.runId,
      responseMessageId: options.responseMessageId,
      execution: options.execution,
    });
  } catch (error) {
    reportPostDeliveryPersistenceFailure({
      error,
      operation: "agent-run.complete",
      runId: options.runId,
      messageId: options.context.turn.discordMessageId,
      discordContext: options.discordContext,
    });
  }
}

async function processAdmittedTurn(
  context: MessageContext,
  runId: string,
): Promise<void> {
  let responseMessage: Message | undefined;
  let finalResponseDelivered = false;
  const discordContext: DiscordContext = {
    guildId: context.turn.guildId,
    channelId: context.turn.channelId,
    userId: context.turn.userId,
    username: context.turn.username,
    messageId: context.turn.discordMessageId,
  };
  setSentryContext(discordContext);
  try {
    responseMessage = await withDiscordDelivery({
      context,
      phase: "placeholder",
      operation: async () => await context.message.reply(PLACEHOLDER),
    });
    const deliveredResponseMessage = responseMessage;
    if (context.activeSessionId != null) {
      await appendSessionEvent({
        sessionId: context.activeSessionId,
        role: "user",
        eventType: "message",
        content: context.turn.content,
        discordMessageId: context.turn.discordMessageId,
      });
    }
    const persona = await getGuildPersona(context.turn.guildId);
    const bundle = await buildContextForTurn({
      turn: context.turn,
      message: context.message,
      persona,
      ...(context.activeSessionId == null
        ? {}
        : { sessionId: context.activeSessionId }),
    });
    await recordAgentRunContext({ runId, persona, context: bundle });
    const personaSource = bundle.sources.find(({ kind }) => kind === "persona");
    if (personaSource == null) {
      throw new Error(
        "Context bundle is missing its compact persona projection",
      );
    }
    const route = await routeTurn({
      turn: context.turn,
      personaId: persona,
      persona: personaSource.content,
      context: bundle,
    });
    await recordAgentRunRoute(runId, route);
    const requestContext: RequestContext = {
      sourceChannelId: context.turn.channelId,
      sourceMessageId: context.turn.discordMessageId,
      guildId: context.turn.guildId,
      userId: context.turn.userId,
      personaId: persona,
      ...(context.turn.voiceChannelId == null
        ? {}
        : { voiceChannelId: context.turn.voiceChannelId }),
    };
    const execution = await runWithRequestContext(
      requestContext,
      async () =>
        await executeRoutedTurn({
          turn: context.turn,
          context: bundle,
          personaId: persona,
          persona: personaSource.content,
          route,
        }),
    );
    const response = validateResponse(execution.text);
    await withDiscordDelivery({
      context,
      phase: "final",
      operation: async () => await deliveredResponseMessage.edit(response),
    });
    finalResponseDelivered = true;
    markEngaged(context.turn.channelId);
    await persistDeliveredTurn({
      context,
      runId,
      response,
      responseMessageId: deliveredResponseMessage.id,
      execution,
      discordContext,
    });

    if (requestContext.suppressAutomaticMemoryExtraction === true) {
      logger.info("Automatic memory extraction suppressed after deletion", {
        runId,
        messageId: context.turn.discordMessageId,
      });
    } else {
      const config = getConfig();
      const transcript = await getConversationTranscriptResult(
        context.message,
        {
          windowMs: config.responder.transcriptWindowMs,
          maxMessages: config.responder.transcriptMaxMessages,
        },
      );
      try {
        await extractAndApplyTurnMemory({
          turn: context.turn,
          persona,
          rawRecentMessages: transcript.messages,
        });
      } catch (error) {
        logger.error("Post-response memory extraction failed", error, {
          runId,
          messageId: context.turn.discordMessageId,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
        captureException(toError(error), {
          operation: "memory.extract",
          discord: discordContext,
          extra: { runId },
        });
      }
    }
  } catch (error) {
    if (finalResponseDelivered) {
      reportPostDeliveryPersistenceFailure({
        error,
        operation: "turn.post-delivery",
        runId,
        messageId: context.turn.discordMessageId,
        discordContext,
      });
      return;
    }
    const reference = incidentId();
    if (responseMessage != null) {
      try {
        const failedResponseMessage = responseMessage;
        await withDiscordDelivery({
          context,
          phase: "incident",
          operation: async () =>
            await failedResponseMessage.edit(
              `I couldn't complete that request. Reference: ${reference}`,
            ),
        });
      } catch (deliveryError) {
        logger.error(
          "Could not deliver Birmel incident reference",
          deliveryError,
          {
            runId,
            incidentId: reference,
          },
        );
      }
    }
    await failAgentRun({
      runId,
      ...(responseMessage == null
        ? {}
        : { responseMessageId: responseMessage.id }),
      incidentId: reference,
      error,
    });
    logger.error("Birmel turn failed", error, {
      runId,
      incidentId: reference,
      messageId: context.turn.discordMessageId,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    captureException(toError(error), {
      operation: "agent.turn",
      discord: discordContext,
      extra: { runId, incidentId: reference },
    });
  } finally {
    clearSentryContext();
  }
}

export async function handleMessage(context: MessageContext): Promise<void> {
  const run = await admitAgentRun(context.turn);
  if (run == null) {
    logger.info("Duplicate Discord turn ignored", {
      messageId: context.turn.discordMessageId,
      guildId: context.turn.guildId,
      channelId: context.turn.channelId,
    });
    return;
  }
  const queueId = context.activeSessionId ?? context.turn.channelId;
  await withSpan(
    "birmel.turn",
    {
      guildId: context.turn.guildId,
      channelId: context.turn.channelId,
      userId: context.turn.userId,
      messageId: context.turn.discordMessageId,
      triggerKind: context.turn.triggerKind,
    },
    async (span) => {
      await withTurnQueue(queueId, async () => {
        if (context.activeSessionId != null) {
          const threadId = context.turn.threadId;
          const sessionIsActive =
            threadId != null &&
            (await isSessionActiveForThread({
              sessionId: context.activeSessionId,
              guildId: context.turn.guildId,
              threadId,
            }));
          if (!sessionIsActive) {
            await suppressQueuedSessionAgentRun(run.id);
            span.setAttribute("birmel.turn.suppressed", true);
            span.setAttribute(
              "birmel.turn.suppression_reason",
              "session-inactive-while-queued",
            );
            logger.info("Queued session turn suppressed", {
              runId: run.id,
              messageId: context.turn.discordMessageId,
              guildId: context.turn.guildId,
              threadId: context.turn.threadId ?? "missing",
              reason: "session-inactive-while-queued",
            });
            return;
          }
        }
        await processAdmittedTurn(context, run.id);
      });
    },
  );
}
