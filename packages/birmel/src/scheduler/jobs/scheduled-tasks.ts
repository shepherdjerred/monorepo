import type { AgentJob } from "#generated/prisma/client/index.js";
import {
  getStagedAttachments,
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { toDiscordAttachments } from "@shepherdjerred/birmel/agent-tools/tools/staged-attachments.ts";
import {
  DeliveryResultSchema,
  EffectDispositionSchema,
  type AgentJobExecution,
  type AgentJobRuntimeDependencies,
} from "@shepherdjerred/birmel/scheduler/agent-job-delivery.ts";
import { recordPostExecutionSessionEvent } from "@shepherdjerred/birmel/scheduler/agent-job-session-events.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { handleSend } from "@shepherdjerred/birmel/agent-tools/tools/discord/actions/message-actions.ts";
import {
  createEffectCheckpoint,
  serializeCheckpointOutput,
} from "@shepherdjerred/birmel/scheduler/agent-job-effect-state.ts";
import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";
import { getToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { z } from "zod";

const AgentExecutionResultSchema = z.object({
  message: z.string().min(1).max(20_000),
  data: z.unknown().optional(),
});
const ExecutableToolSchema = z.object({ execute: z.function() }).loose();
const ScheduledToolResultSchema = z
  .object({
    success: z.boolean(),
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

// A job's turn stages attachments the same way an interactive turn does, so
// they have to be read back here too. Delivering only `message` meant an image
// generated inside a scheduled job was produced, billed and then dropped.
async function deliverDiscordMessage(
  channelId: string,
  message: string,
  execution: AgentJobExecution,
): Promise<unknown> {
  const files = toDiscordAttachments(
    getStagedAttachments(execution.requestContext),
  );
  if (Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"] === "true") {
    return {
      success: true,
      effectDisposition: "applied",
      mockDelivery: true,
      channelId,
      message,
      attachmentCount: files.length,
    };
  }
  const result = await handleSend(getDiscordClient(), channelId, message, {
    files,
  });
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
    toolResult.effectDisposition === "not_applied"
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
  // allTools gives the agent manage-message now; block it from posting here.
  const channelId = await deliveryChannelFor(job);
  const { effectState, beforeExternalEffect } = createEffectCheckpoint(() =>
    beginExternalEffect(execution),
  );
  // channelId (resolved delivery channel) can differ from the job's original
  // source channel. Both the guard tools check and the model's own prompt
  // context must agree on it, or a reply to the original channel slips past
  // enforceSingleRuntimeReply and becomes a second, unintended message.
  const requestContext = {
    ...execution.requestContext,
    beforeExternalEffect,
    ownsSourceReply: true,
    sourceChannelId: channelId,
  };
  // The turn runs against this cloned context, so anything a tool stages during
  // it — a generated image, say — lands here and not on execution.requestContext.
  // Delivery has to be handed the same clone or the attachments are invisible.
  const turnExecution = { ...execution, requestContext };
  const result = AgentExecutionResultSchema.parse(
    await runWithRequestContext(
      requestContext,
      async () =>
        await runtimeDependencies.executeAgent(agentPrompt, turnExecution),
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
  if (!effectState.acquiredByTool) {
    effectState.checkpoint ??= beginExternalEffect(execution);
    await effectState.checkpoint;
  }
  const delivery = await runtimeDependencies.deliverMessage(
    channelId,
    result.message,
    turnExecution,
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
