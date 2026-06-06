import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { z } from "zod";

const ManageAgentSessionInputSchema = z.object({
  action: z.enum([
    "create",
    "list",
    "get",
    "history",
    "follow-up",
    "steer",
    "cancel",
    "archive",
    "resume",
    "set-options",
    "spawn",
  ]),
  guildId: z.string(),
  channelId: z.string().optional(),
  threadId: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  label: z.string().optional(),
  content: z.string().optional(),
  steeringPolicy: z.enum(["steer", "advisory", "locked"]).optional(),
  model: z.string().optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  summary: z.string().optional(),
  expiresAt: z.string().optional(),
  includeArchived: z.boolean().optional(),
});

type ManageAgentSessionContext = z.infer<typeof ManageAgentSessionInputSchema>;
type AgentSessionToolResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

async function createSession(
  ctx: ManageAgentSessionContext,
): Promise<AgentSessionToolResult> {
  if (ctx.channelId == null || ctx.channelId.length === 0) {
    return { success: false, message: "channelId is required" };
  }
  if (ctx.userId == null || ctx.userId.length === 0) {
    return { success: false, message: "userId is required" };
  }
  const session = await prisma.agentSession.create({
    data: {
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      threadId: ctx.threadId ?? null,
      userId: ctx.userId,
      label: ctx.label ?? null,
      status: ctx.action === "spawn" ? "background" : "active",
      steeringPolicy: ctx.steeringPolicy ?? "steer",
      model: ctx.model ?? null,
      reasoningEffort: ctx.reasoningEffort ?? null,
      textVerbosity: ctx.textVerbosity ?? null,
      summary: ctx.summary ?? null,
      expiresAt: ctx.expiresAt == null ? null : new Date(ctx.expiresAt),
    },
  });
  return {
    success: true,
    message: "Agent session created",
    data: { session },
  };
}

async function listSessions(
  ctx: ManageAgentSessionContext,
): Promise<AgentSessionToolResult> {
  const sessions = await prisma.agentSession.findMany({
    where: {
      guildId: ctx.guildId,
      ...(ctx.channelId == null ? {} : { channelId: ctx.channelId }),
      ...(ctx.threadId == null ? {} : { threadId: ctx.threadId }),
      ...(ctx.userId == null ? {} : { userId: ctx.userId }),
      ...(ctx.includeArchived === true
        ? {}
        : { status: { notIn: ["archived", "cancelled"] } }),
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });
  return {
    success: true,
    message: `Found ${String(sessions.length)} session${sessions.length === 1 ? "" : "s"}`,
    data: { sessions },
  };
}

async function getSession(
  ctx: ManageAgentSessionContext,
): Promise<AgentSessionToolResult> {
  if (ctx.sessionId == null || ctx.sessionId.length === 0) {
    return { success: false, message: "sessionId is required" };
  }
  const session = await prisma.agentSession.findFirst({
    where: { id: ctx.sessionId, guildId: ctx.guildId },
  });
  if (session == null) {
    return { success: false, message: "Agent session not found" };
  }
  const events =
    ctx.action === "history"
      ? await prisma.agentSessionEvent.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: "asc" },
          take: 100,
        })
      : [];
  return {
    success: true,
    message: "Agent session found",
    data: { session, events },
  };
}

async function addSessionEvent(
  ctx: ManageAgentSessionContext,
): Promise<AgentSessionToolResult> {
  if (ctx.sessionId == null || ctx.sessionId.length === 0) {
    return { success: false, message: "sessionId is required" };
  }
  if (ctx.content == null || ctx.content.length === 0) {
    return { success: false, message: "content is required" };
  }
  const session = await prisma.agentSession.findFirst({
    where: { id: ctx.sessionId, guildId: ctx.guildId },
  });
  if (session == null) {
    return { success: false, message: "Agent session not found" };
  }
  const event = await prisma.agentSessionEvent.create({
    data: {
      sessionId: session.id,
      role: ctx.action === "steer" ? "system" : "user",
      eventType: ctx.action,
      content: ctx.content,
      metadata: JSON.stringify({
        steeringPolicy: ctx.steeringPolicy ?? session.steeringPolicy,
      }),
    },
  });
  await prisma.agentSession.update({
    where: { id: session.id },
    data: {
      status: ctx.action === "steer" ? "steered" : session.status,
      steeringPolicy: ctx.steeringPolicy ?? session.steeringPolicy,
    },
  });
  return {
    success: true,
    message: "Agent session event recorded",
    data: { event },
  };
}

async function setSessionStatus(
  ctx: ManageAgentSessionContext,
): Promise<AgentSessionToolResult> {
  if (ctx.sessionId == null || ctx.sessionId.length === 0) {
    return { success: false, message: "sessionId is required" };
  }
  const status =
    ctx.action === "resume"
      ? "active"
      : ctx.action === "archive"
        ? "archived"
        : "cancelled";
  const updated = await prisma.agentSession.updateMany({
    where: { id: ctx.sessionId, guildId: ctx.guildId },
    data: { status },
  });
  if (updated.count === 0) {
    return { success: false, message: "Agent session not found" };
  }
  return { success: true, message: `Agent session ${status}` };
}

async function setSessionOptions(
  ctx: ManageAgentSessionContext,
): Promise<AgentSessionToolResult> {
  if (ctx.sessionId == null || ctx.sessionId.length === 0) {
    return { success: false, message: "sessionId is required" };
  }
  const session = await prisma.agentSession.findFirst({
    where: { id: ctx.sessionId, guildId: ctx.guildId },
  });
  if (session == null) {
    return { success: false, message: "Agent session not found" };
  }
  const updated = await prisma.agentSession.update({
    where: { id: session.id },
    data: {
      model: ctx.model ?? session.model,
      reasoningEffort: ctx.reasoningEffort ?? session.reasoningEffort,
      textVerbosity: ctx.textVerbosity ?? session.textVerbosity,
      steeringPolicy: ctx.steeringPolicy ?? session.steeringPolicy,
      summary: ctx.summary ?? session.summary,
      expiresAt:
        ctx.expiresAt == null ? session.expiresAt : new Date(ctx.expiresAt),
    },
  });
  return {
    success: true,
    message: "Agent session options updated",
    data: { session: updated },
  };
}

export const manageAgentSessionTool = createTool({
  id: "manage-agent-session",
  description:
    "Manage persisted Birmel agent sessions anchored to Discord guild/channel/thread/user context. Supports list, create, get status/history, follow-up event, steer, cancel, archive, resume, model/reasoning overrides, and background/isolated session spawning.",
  inputSchema: ManageAgentSessionInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "create":
        case "spawn":
          return await createSession(ctx);
        case "list":
          return await listSessions(ctx);
        case "get":
        case "history":
          return await getSession(ctx);
        case "follow-up":
        case "steer":
          return await addSessionEvent(ctx);
        case "cancel":
        case "archive":
        case "resume":
          return await setSessionStatus(ctx);
        case "set-options":
          return await setSessionOptions(ctx);
      }
    } catch (error) {
      logger.error("Failed to manage agent session", error);
      return { success: false, message: getErrorMessage(error) };
    }
  },
});

export const agentSessionTools = [manageAgentSessionTool];
