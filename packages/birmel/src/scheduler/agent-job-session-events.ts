import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { DeliveryResultSchema } from "@shepherdjerred/birmel/scheduler/agent-job-delivery.ts";
import type { AgentJobExecution } from "@shepherdjerred/birmel/scheduler/agent-job-delivery.ts";
import { appendSessionEvent } from "@shepherdjerred/birmel/sessions/service.ts";
import { summarizeSessionIfNeeded } from "@shepherdjerred/birmel/sessions/summarization.ts";
import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.scheduler.child("agent-job-session-events");

export async function appendJobSessionEvent(options: {
  execution: AgentJobExecution;
  role: "assistant" | "tool";
  eventType: string;
  content: string;
  toolId?: string;
  delivery?: unknown;
}): Promise<void> {
  if (options.execution.sessionId == null) {
    return;
  }
  const delivery = DeliveryResultSchema.safeParse(options.delivery);
  await appendSessionEvent({
    sessionId: options.execution.sessionId,
    role: options.role,
    eventType: options.eventType,
    content: options.content,
    ...(options.toolId == null ? {} : { toolId: options.toolId }),
    ...(!delivery.success || delivery.data.data == null
      ? {}
      : { discordMessageId: delivery.data.data.messageId }),
  });
  await summarizeSessionIfNeeded(options.execution.sessionId);
}

export async function recordPostExecutionSessionEvent(
  options: Parameters<typeof appendJobSessionEvent>[0],
): Promise<void> {
  try {
    await appendJobSessionEvent(options);
  } catch (error) {
    logger.error("Post-execution session event persistence failed", error, {
      jobId: options.execution.jobId,
      guildId: options.execution.guildId,
      eventType: options.eventType,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    captureException(toError(error), {
      operation: "job.session-event.post-execution",
      discord: {
        guildId: options.execution.guildId,
        userId: options.execution.actorUserId,
      },
      extra: {
        jobId: options.execution.jobId,
        eventType: options.eventType,
      },
    });
  }
}
