import type { AgentJob } from "#generated/prisma/client/index.js";
import {
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { handleSend } from "@shepherdjerred/birmel/agent-tools/tools/discord/message-actions.ts";
import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";
import { appendSessionEvent } from "@shepherdjerred/birmel/sessions/service.ts";
import { summarizeSessionIfNeeded } from "@shepherdjerred/birmel/sessions/summarization.ts";
import { z } from "zod";

export type AgentJobExecution = {
  jobId: string;
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
const DeliveryResultSchema = z
  .object({
    data: z.object({ messageId: z.string().min(1) }).optional(),
  })
  .loose();

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
    return { success: true, mockDelivery: true, channelId, message };
  }
  return await handleSend(getDiscordClient(), channelId, message);
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
  requestContext: RequestContext,
): AgentJobExecution {
  return {
    jobId: job.id,
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
  const result = await runtimeDependencies.executeTool(
    job.toolId,
    input,
    execution,
  );
  await appendJobSessionEvent({
    execution,
    role: "tool",
    eventType: "scheduled-tool-summary",
    content: `Scheduled tool ${job.toolId} completed`,
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
  const delivery = await runtimeDependencies.deliverMessage(
    channelId,
    job.message,
    execution,
  );
  await appendJobSessionEvent({
    execution,
    role: "assistant",
    eventType: "scheduled-message",
    content: job.message,
    delivery,
  });
  return delivery;
}

async function executeAgentPayload(
  job: AgentJob,
  execution: AgentJobExecution,
): Promise<unknown> {
  if (job.agentPrompt == null || job.agentPrompt.length === 0) {
    throw new Error("agentPrompt is required for agent jobs");
  }
  const result = AgentExecutionResultSchema.parse(
    await runtimeDependencies.executeAgent(job.agentPrompt, execution),
  );
  const channelId = await deliveryChannelFor(job);
  const delivery = await runtimeDependencies.deliverMessage(
    channelId,
    result.message,
    execution,
  );
  await appendJobSessionEvent({
    execution,
    role: "assistant",
    eventType: "scheduled-agent-message",
    content: result.message,
    delivery,
  });
  return { data: result.data, delivery };
}

export async function executeDurableAgentJob(job: AgentJob): Promise<unknown> {
  verifyStoredActor(job);
  const requestContext = restoredRequestContext(job);
  const execution = executionDescriptor(job, requestContext);
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

export function currentAgentJobRequestContext(): RequestContext | undefined {
  return getRequestContext();
}
