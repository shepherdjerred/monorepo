import type { AgentRun } from "#generated/prisma/client/index.js";
import type { AgentExecutionResult } from "@shepherdjerred/birmel/agent-runtime/specialists.ts";
import type {
  ContextBundle,
  RouteDecision,
  TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { z } from "zod";

const UniqueConstraintErrorSchema = z.object({ code: z.literal("P2002") });

export async function admitAgentRun(turn: TurnInput): Promise<AgentRun | null> {
  try {
    return await prisma.agentRun.create({
      data: {
        discordMessageId: turn.discordMessageId,
        guildId: turn.guildId,
        channelId: turn.channelId,
        threadId: turn.threadId ?? null,
        actorUserId: turn.userId,
        triggerKind: turn.triggerKind,
      },
    });
  } catch (error) {
    if (UniqueConstraintErrorSchema.safeParse(error).success) {
      return null;
    }
    throw error;
  }
}

export async function recordAgentRunContext(options: {
  runId: string;
  persona: string;
  context: ContextBundle;
}): Promise<void> {
  await prisma.agentRun.update({
    where: { id: options.runId },
    data: {
      persona: options.persona,
      status: "context-ready",
      contextCoreCharacters: options.context.sizes.coreInstructions,
      contextPersonaCharacters: options.context.sizes.persona,
      contextMemoryCharacters: options.context.sizes.loreAndMemory,
      contextTranscriptChars: options.context.sizes.transcript,
      selectedMemoryCount: options.context.selectedMemoryClaimIds.length,
    },
  });
}

export async function recordAgentRunRoute(
  runId: string,
  decision: RouteDecision,
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { route: decision.route, status: "running" },
  });
}

export async function completeAgentRun(options: {
  runId: string;
  responseMessageId: string;
  execution: AgentExecutionResult;
}): Promise<void> {
  await prisma.agentRun.update({
    where: { id: options.runId },
    data: {
      status: "completed",
      responseMessageId: options.responseMessageId,
      inputTokens: options.execution.inputTokens,
      outputTokens: options.execution.outputTokens,
      finishReason: options.execution.finishReason,
      completedAt: new Date(),
    },
  });
}

export async function suppressQueuedSessionAgentRun(
  runId: string,
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: "suppressed",
      finishReason: "session-inactive-while-queued",
      completedAt: new Date(),
    },
  });
}

export async function failAgentRun(options: {
  runId: string;
  responseMessageId?: string;
  incidentId: string;
  error: unknown;
}): Promise<void> {
  await prisma.agentRun.update({
    where: { id: options.runId },
    data: {
      status: "failed",
      responseMessageId: options.responseMessageId ?? null,
      incidentId: options.incidentId,
      errorClass:
        options.error instanceof Error ? options.error.name : "UnknownError",
      failedAt: new Date(),
    },
  });
}
