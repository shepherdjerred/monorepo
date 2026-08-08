import type { AgentJob } from "#generated/prisma/client/index.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { handleSend } from "@shepherdjerred/birmel/agent-tools/tools/discord/message-actions.ts";
import { serializeAgentJobOutput } from "@shepherdjerred/birmel/scheduler/agent-job-effect-state.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import {
  parseJsonRecord,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { appendSessionEvent } from "@shepherdjerred/birmel/sessions/service.ts";
import { summarizeSessionIfNeeded } from "@shepherdjerred/birmel/sessions/summarization.ts";
import { getToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { z } from "zod";

const logger = loggers.scheduler.child("scheduled-tasks");

export type AgentJobExecution = {
  jobId: string;
  runId: string;
  claimId: string;
  guildId: string;
  actorUserId: string;
  sessionId: string | null;
  model: string | null;
  reasoningEffort: string | null;
  textVerbosity: string | null;
  timeoutMs: number;
  requestContext: RequestContext;
};

export type AgentJobRuntimeDependencies = {
  executeTool: (
    toolId: string,
    input: Record<string, unknown>,
    execution: AgentJobExecution,
  ) => Promise<unknown>;
  executeAgent: (
    prompt: string,
    execution: AgentJobExecution,
  ) => Promise<unknown>;
  deliverMessage: (
    channelId: string,
    message: string,
    execution: AgentJobExecution,
  ) => Promise<unknown>;
};
const AgentExecutionResultSchema = z.object({
  message: z.string().min(1).max(20_000),
  data: z.unknown().optional(),
});
const ExecutableToolSchema = z.object({ execute: z.function() }).loose();
const EffectDispositionSchema = z.enum(["not_applied", "applied", "unknown"]);
const ScheduledToolResultSchema = z
  .object({
    success: z.boolean(),
    effectDisposition: EffectDispositionSchema.optional(),
  })
  .loose();
const DeliveryResultSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
    data: z.object({ messageId: z.string().min(1) }).optional(),
    effectDisposition: EffectDispositionSchema.optional(),
  })
  .loose();

function requireSuccessfulDelivery(delivery: unknown) {
  const parsedDelivery = DeliveryResultSchema.parse(delivery);
  if (!parsedDelivery.success) {
    throw new Error(
      parsedDelivery.message ?? "Discord delivery reported failure",
    );
  }
  return parsedDelivery;
}

function serializeCheckpointOutput(value: unknown): string {
  return serializeAgentJobOutput(value).slice(0, 20_000);
}

async function beginExternalEffect(
  execution: AgentJobExecution,
): Promise<void> {
  const updated = await prisma.$transaction(async (transaction) => {
    const activeJob = await transaction.agentJob.findFirst({
      where: {
        id: execution.jobId,
        status: "running",
        claimedBy: execution.claimId,
      },
      select: { id: true },
    });
    if (activeJob == null) {
      return 0;
    }
    const run = await transaction.agentJobRun.updateMany({
      where: {
        id: execution.runId,
        jobId: execution.jobId,
        status: "running",
      },
      data: { status: "effect_in_flight" },
    });
    return run.count;
  });
  if (updated !== 1) {
    throw new Error(
      "Agent job effect could not acquire its durable checkpoint",
    );
  }
}

async function acknowledgeExternalEffect(
  execution: AgentJobExecution,
  output: unknown,
): Promise<void> {
  const updated = await prisma.agentJobRun.updateMany({
    where: {
      id: execution.runId,
      jobId: execution.jobId,
      status: "effect_in_flight",
    },
    data: {
      status: "effect_acknowledged",
      output: serializeCheckpointOutput(output),
    },
  });
  if (updated.count !== 1) {
    throw new Error("Agent job effect acknowledgement could not be persisted");
  }
}

async function recordExternalEffectNotApplied(
  execution: AgentJobExecution,
): Promise<void> {
  const updated = await prisma.agentJobRun.updateMany({
    where: {
      id: execution.runId,
      jobId: execution.jobId,
      status: "effect_in_flight",
    },
    data: { status: "running" },
  });
  if (updated.count !== 1) {
    throw new Error(
      "Agent job not-applied effect disposition was not persisted",
    );
  }
}

async function appendJobSessionEvent(options: {
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

async function recordPostExecutionSessionEvent(
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

async function executeRegisteredTool(
  toolId: string,
  input: Record<string, unknown>,
  execution: AgentJobExecution,
): Promise<unknown> {
  const { allTools } =
    await import("@shepherdjerred/birmel/agent-tools/tools/index.ts");
  const tool = allTools[toolId];
  if (tool == null) {
    throw new Error(`Tool not found or not executable: ${toolId}`);
  }
  const executableTool = ExecutableToolSchema.parse(tool);
  return await Reflect.apply(executableTool.execute, undefined, [
    input,
    {
      runId: `agent-job-${execution.jobId}`,
      agentId: "birmel-job-runner",
    },
  ]);
}

async function executeUnconfiguredAgent(): Promise<never> {
  await Bun.sleep(0);
  throw new Error("Agent job executor has not been configured");
}

async function deliverDiscordMessage(
  channelId: string,
  message: string,
): Promise<unknown> {
  if (Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"] === "true") {
    return {
      success: true,
      effectDisposition: "applied",
      mockDelivery: true,
      channelId,
      message,
    };
  }
  const result = await handleSend(getDiscordClient(), channelId, message);
  return {
    ...result,
    effectDisposition: result.success ? "applied" : "not_applied",
  };
}

const defaultRuntimeDependencies: AgentJobRuntimeDependencies = {
  executeTool: executeRegisteredTool,
  executeAgent: executeUnconfiguredAgent,
  deliverMessage: deliverDiscordMessage,
};

let runtimeDependencies = defaultRuntimeDependencies;

export function configureAgentJobRuntime(
  dependencies: Partial<AgentJobRuntimeDependencies> | null,
): void {
  runtimeDependencies =
    dependencies == null
      ? defaultRuntimeDependencies
      : { ...defaultRuntimeDependencies, ...dependencies };
}

function restoredRequestContext(job: AgentJob): RequestContext {
  const sourceChannelId = job.sourceChannelId ?? job.channelId ?? job.threadId;
  if (sourceChannelId == null || sourceChannelId.length === 0) {
    throw new Error("Stored job has no source channel context");
  }
  return {
    guildId: job.guildId,
    userId: job.actorUserId,
    sourceChannelId,
    sourceMessageId: job.sourceMessageId ?? `legacy-agent-job:${job.id}`,
    ownsSourceReply: false,
  };
}

function verifyStoredActor(job: AgentJob): void {
  if (!getConfig().authority.trustedUserIds.includes(job.actorUserId)) {
    throw new Error("Stored job actor is no longer trusted");
  }
}

async function deliveryChannelFor(job: AgentJob): Promise<string> {
  if (job.sessionId != null) {
    const session = await prisma.agentSession.findFirst({
      where: {
        id: job.sessionId,
        guildId: job.guildId,
        status: "active",
        archivedAt: null,
        cancelledAt: null,
      },
      select: { threadId: true },
    });
    if (session == null) {
      throw new Error("Target agent session is not active");
    }
    return session.threadId;
  }
  const channelId = job.threadId ?? job.channelId;
  if (channelId == null || channelId.length === 0) {
    throw new Error("Stored job has no delivery channel");
  }
  return channelId;
}

function executionDescriptor(
  job: AgentJob,
  runId: string,
  requestContext: RequestContext,
): AgentJobExecution {
  if (job.claimedBy == null) {
    throw new Error(`Agent job ${job.id} has no active claim`);
  }
  return {
    jobId: job.id,
    runId,
    claimId: job.claimedBy,
    guildId: job.guildId,
    actorUserId: job.actorUserId,
    sessionId: job.sessionId,
    model: job.model,
    reasoningEffort: job.reasoningEffort,
    textVerbosity: job.textVerbosity,
    timeoutMs: job.timeoutMs,
    requestContext,
  };
}

async function executeToolPayload(
  job: AgentJob,
  execution: AgentJobExecution,
): Promise<unknown> {
  if (job.toolId == null || job.toolId.length === 0) {
    throw new Error("toolId is required for tool jobs");
  }
  if (job.toolId === "manage-job") {
    throw new Error("manage-job cannot execute itself as a job payload");
  }
  const input =
    job.toolInput == null || job.toolInput.length === 0
      ? {}
      : parseJsonRecord(job.toolInput);
  const requiresEffectCheckpoint =
    getToolMetadata(job.toolId).riskClass !== "read";
  if (requiresEffectCheckpoint) {
    await beginExternalEffect(execution);
  }
  const result = await runtimeDependencies.executeTool(
    job.toolId,
    input,
    execution,
  );
  const toolResult = ScheduledToolResultSchema.parse(result);
  if (requiresEffectCheckpoint && toolResult.success) {
    await acknowledgeExternalEffect(execution, result);
  } else if (
    requiresEffectCheckpoint &&
    (toolResult.effectDisposition == null ||
      toolResult.effectDisposition === "not_applied")
  ) {
    await recordExternalEffectNotApplied(execution);
  }
  const status = toolResult.success ? "succeeded" : "failed";
  await recordPostExecutionSessionEvent({
    execution,
    role: "tool",
    eventType: "scheduled-tool-summary",
    content: `Scheduled tool ${job.toolId} ${status}`,
    toolId: job.toolId,
  });
  return result;
}

async function executeMessagePayload(
  job: AgentJob,
  execution: AgentJobExecution,
): Promise<unknown> {
  if (job.message == null || job.message.length === 0) {
    throw new Error("message is required for message jobs");
  }
  const channelId = await deliveryChannelFor(job);
  await beginExternalEffect(execution);
  const delivery = await runtimeDependencies.deliverMessage(
    channelId,
    job.message,
    execution,
  );
  const parsedDelivery = DeliveryResultSchema.parse(delivery);
  if (
    !parsedDelivery.success &&
    parsedDelivery.effectDisposition === "not_applied"
  ) {
    await recordExternalEffectNotApplied(execution);
  }
  const successfulDelivery = requireSuccessfulDelivery(parsedDelivery);
  await acknowledgeExternalEffect(execution, successfulDelivery);
  await recordPostExecutionSessionEvent({
    execution,
    role: "assistant",
    eventType: "scheduled-message",
    content: job.message,
    delivery: successfulDelivery,
  });
  return successfulDelivery;
}

async function executeAgentPayload(
  job: AgentJob,
  execution: AgentJobExecution,
): Promise<unknown> {
  if (job.agentPrompt == null || job.agentPrompt.length === 0) {
    throw new Error("agentPrompt is required for agent jobs");
  }
  const agentPrompt = job.agentPrompt;
  const effectState: {
    acquiredByTool: boolean;
    checkpoint: Promise<void> | null;
  } = { acquiredByTool: false, checkpoint: null };
  const beforeExternalEffect = async () => {
    effectState.checkpoint ??= beginExternalEffect(execution);
    await effectState.checkpoint;
    effectState.acquiredByTool = true;
  };
  const result = AgentExecutionResultSchema.parse(
    await runWithRequestContext(
      { ...execution.requestContext, beforeExternalEffect },
      async () =>
        await runtimeDependencies.executeAgent(agentPrompt, execution),
    ),
  );
  const resultData = z
    .object({ effectDisposition: EffectDispositionSchema.optional() })
    .loose()
    .parse(result.data ?? {});
  if (resultData.effectDisposition === "not_applied") {
    await recordExternalEffectNotApplied(execution);
  }
  if (resultData.effectDisposition != null) {
    throw new Error(result.message);
  }
  const channelId = await deliveryChannelFor(job);
  if (!effectState.acquiredByTool) {
    effectState.checkpoint ??= beginExternalEffect(execution);
    await effectState.checkpoint;
  }
  const delivery = await runtimeDependencies.deliverMessage(
    channelId,
    result.message,
    execution,
  );
  const parsedDelivery = DeliveryResultSchema.parse(delivery);
  if (
    !effectState.acquiredByTool &&
    !parsedDelivery.success &&
    parsedDelivery.effectDisposition === "not_applied"
  ) {
    await recordExternalEffectNotApplied(execution);
  }
  const successfulDelivery = requireSuccessfulDelivery(parsedDelivery);
  await acknowledgeExternalEffect(execution, successfulDelivery);
  await recordPostExecutionSessionEvent({
    execution,
    role: "assistant",
    eventType: "scheduled-agent-message",
    content: result.message,
    delivery: successfulDelivery,
  });
  return { data: result.data, delivery: successfulDelivery };
}
export async function executeDurableAgentJob(
  job: AgentJob,
  runId: string,
): Promise<unknown> {
  verifyStoredActor(job);
  const requestContext = restoredRequestContext(job);
  const execution = executionDescriptor(job, runId, requestContext);
  return await runWithRequestContext(requestContext, async () => {
    switch (job.payloadKind) {
      case "message":
        return await executeMessagePayload(job, execution);
      case "tool":
        return await executeToolPayload(job, execution);
      case "agent":
        return await executeAgentPayload(job, execution);
      default:
        throw new Error(`Unknown payload kind: ${job.payloadKind}`);
    }
  });
}
