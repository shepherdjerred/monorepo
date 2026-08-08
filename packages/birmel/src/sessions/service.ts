import type {
  AgentSession,
  AgentSessionEvent,
} from "#generated/prisma/client/index.js";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { z } from "zod";

const UniqueConstraintErrorSchema = z.object({ code: z.literal("P2002") });

export const SessionEventRoleSchema = z.enum(["user", "assistant", "tool"]);
export type SessionEventRole = z.infer<typeof SessionEventRoleSchema>;
export const MAX_SESSION_EVENT_CONTENT_CHARACTERS = 20_000;
const SessionEventContentSchema = z
  .string()
  .max(MAX_SESSION_EVENT_CONTENT_CHARACTERS);

export async function getActiveSessionForThread(
  threadId: string,
): Promise<AgentSession | null> {
  return await prisma.agentSession.findFirst({
    where: { threadId, status: "active" },
  });
}

export async function isSessionActiveForThread(options: {
  sessionId: string;
  guildId: string;
  threadId: string;
}): Promise<boolean> {
  const session = await prisma.agentSession.findFirst({
    where: {
      id: options.sessionId,
      guildId: options.guildId,
      threadId: options.threadId,
      status: "active",
    },
    select: { id: true },
  });
  return session != null;
}

export async function createThreadForSession(options: {
  sourceChannelId: string;
  sourceMessageId: string;
  label?: string;
}): Promise<{ threadId: string; parentChannelId: string }> {
  const channel = await getDiscordClient().channels.fetch(
    options.sourceChannelId,
  );
  if (channel?.isTextBased() !== true) {
    throw new Error("Session source is not a text channel");
  }
  if (channel.isThread()) {
    return {
      threadId: channel.id,
      parentChannelId: channel.parentId ?? options.sourceChannelId,
    };
  }
  if (!("messages" in channel)) {
    throw new Error("Session source channel cannot fetch messages");
  }
  const sourceMessage = await channel.messages.fetch(options.sourceMessageId);
  const thread = await sourceMessage.startThread({
    name:
      options.label ?? `Birmel session ${options.sourceMessageId.slice(-6)}`,
    autoArchiveDuration: 1440,
  });
  return { threadId: thread.id, parentChannelId: channel.id };
}

export async function createSession(options: {
  guildId: string;
  channelId: string;
  threadId: string;
  actorUserId: string;
  label?: string;
}): Promise<AgentSession> {
  return await prisma.agentSession.create({
    data: {
      guildId: options.guildId,
      channelId: options.channelId,
      threadId: options.threadId,
      actorUserId: options.actorUserId,
      label: options.label ?? null,
    },
  });
}

export async function appendSessionEvent(options: {
  sessionId: string;
  role: SessionEventRole;
  eventType: string;
  content: string;
  discordMessageId?: string;
  toolId?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentSessionEvent> {
  const input = {
    ...options,
    role: SessionEventRoleSchema.parse(options.role),
    content: SessionEventContentSchema.parse(options.content),
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const latest = await transaction.agentSessionEvent.aggregate({
          where: { sessionId: input.sessionId },
          _max: { sequence: true },
        });
        return await transaction.agentSessionEvent.create({
          data: {
            sessionId: input.sessionId,
            sequence: (latest._max.sequence ?? 0) + 1,
            role: input.role,
            eventType: input.eventType,
            content: input.content,
            discordMessageId: input.discordMessageId ?? null,
            toolId: input.toolId ?? null,
            metadata:
              input.metadata == null ? null : JSON.stringify(input.metadata),
          },
        });
      });
    } catch (error) {
      if (
        attempt === 3 ||
        !UniqueConstraintErrorSchema.safeParse(error).success
      ) {
        throw error;
      }
    }
  }
  throw new Error("Could not append a monotonically ordered session event");
}

export async function getSessionContext(sessionId: string): Promise<{
  summary: string | undefined;
  events: AgentSessionEvent[];
}> {
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const events = await prisma.agentSessionEvent.findMany({
    where: {
      sessionId,
      sequence: { gt: session.summaryThroughSequence },
    },
    orderBy: { sequence: "desc" },
    take: 50,
  });
  return {
    summary: session.summary ?? undefined,
    events: events.reverse(),
  };
}

export async function updateSessionStatus(options: {
  sessionId: string;
  guildId: string;
  status: "active" | "archived" | "cancelled";
}): Promise<boolean> {
  const now = new Date();
  const update = await prisma.agentSession.updateMany({
    where: { id: options.sessionId, guildId: options.guildId },
    data: {
      status: options.status,
      archivedAt: options.status === "archived" ? now : null,
      cancelledAt: options.status === "cancelled" ? now : null,
    },
  });
  return update.count === 1;
}
