import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import {
  createSession,
  createThreadForSession,
  updateSessionStatus,
} from "@shepherdjerred/birmel/sessions/service.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { z } from "zod";

const InputSchema = z.object({
  action: z.enum([
    "create",
    "list",
    "get",
    "history",
    "cancel",
    "archive",
    "resume",
  ]),
  guildId: z.string(),
  sessionId: z.uuid().optional(),
  label: z.string().min(1).max(100).optional(),
  includeArchived: z.boolean().optional(),
});

const OutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const manageAgentSessionTool = createTool({
  id: "manage-agent-session",
  description:
    "Create and manage a real Discord-thread-bound agent session. Users steer sessions by writing in the thread. Supports create, list, get, history, cancel, archive, and resume.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input) => {
    try {
      const request = getRequestContext();
      if (request == null) {
        throw new Error("Session operation requires request context");
      }
      if (input.action === "create") {
        const thread = await createThreadForSession({
          sourceChannelId: request.sourceChannelId,
          sourceMessageId: request.sourceMessageId,
          ...(input.label == null ? {} : { label: input.label }),
        });
        const session = await createSession({
          guildId: request.guildId,
          channelId: thread.parentChannelId,
          threadId: thread.threadId,
          actorUserId: request.userId,
          ...(input.label == null ? {} : { label: input.label }),
        });
        return {
          success: true,
          message: "Agent session created",
          data: { session },
        };
      }
      if (input.action === "list") {
        const sessions = await prisma.agentSession.findMany({
          where: {
            guildId: request.guildId,
            ...(input.includeArchived === true
              ? {}
              : { status: { notIn: ["archived", "cancelled"] } }),
          },
          orderBy: { updatedAt: "desc" },
          take: 25,
        });
        return {
          success: true,
          message: `Found ${String(sessions.length)} sessions`,
          data: { sessions },
        };
      }
      if (input.sessionId == null) {
        return { success: false, message: "sessionId is required" };
      }
      const session = await prisma.agentSession.findFirst({
        where: { id: input.sessionId, guildId: request.guildId },
      });
      if (session == null) {
        return { success: false, message: "Agent session not found" };
      }
      if (input.action === "get") {
        return {
          success: true,
          message: "Agent session found",
          data: { session },
        };
      }
      if (input.action === "history") {
        const events = await prisma.agentSessionEvent.findMany({
          where: { sessionId: session.id },
          orderBy: { sequence: "asc" },
          take: 100,
        });
        return {
          success: true,
          message: "Agent session history",
          data: { session, events },
        };
      }
      const status =
        input.action === "resume"
          ? "active"
          : input.action === "archive"
            ? "archived"
            : "cancelled";
      const changed = await updateSessionStatus({
        sessionId: session.id,
        guildId: request.guildId,
        status,
      });
      return changed
        ? { success: true, message: `Agent session ${status}` }
        : { success: false, message: "Agent session not found" };
    } catch (error) {
      logger.error("Failed to manage agent session", error);
      return { success: false, message: getErrorMessage(error) };
    }
  },
});

export const agentSessionTools = [manageAgentSessionTool];
