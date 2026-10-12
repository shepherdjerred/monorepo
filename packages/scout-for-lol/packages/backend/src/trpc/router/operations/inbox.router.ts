import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { router } from "#src/trpc/trpc.ts";
import {
  operatorMutationProcedure,
  operatorProcedure,
} from "#src/trpc/router/operations/operations-access.ts";
import {
  ConversationCursorSchema,
  deleteSupportConversation,
  lockSupportSender,
  readConversation,
} from "#src/support/conversations.ts";
import { wakeSupportJobs } from "#src/support/jobs.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { supportStats } from "#src/support/measurement.ts";

const ConversationIdSchema = z.object({ id: z.uuid() });
export const inboxRouter = router({
  stats: operatorProcedure.query(supportStats),
  storageFailures: operatorProcedure.query(
    async () =>
      await prisma.supportJob.findMany({
        where: { kind: { in: ["ARCHIVE", "DELETE_OBJECT"] }, status: "FAILED" },
        select: {
          id: true,
          kind: true,
          errorCode: true,
          createdAt: true,
          conversationId: true,
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
  ),
  availability: operatorProcedure.query(async () => ({
    available: true,
    unreadCount: await prisma.supportConversation.count({
      where: { messages: { some: { direction: "INBOUND", readAt: null } } },
    }),
  })),
  list: operatorProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        needsReplyOnly: z.boolean().default(false),
        status: z.enum(["OPEN", "WAITING_ON_USER", "RESOLVED"]).optional(),
        cursor: z
          .object({ lastMessageAt: z.coerce.date(), id: z.uuid() })
          .optional(),
      }),
    )
    .query(async ({ input }) => {
      const rows = await prisma.supportConversation.findMany({
        where: {
          messages: { some: { direction: "INBOUND" } },
          ...(input.unreadOnly
            ? { messages: { some: { direction: "INBOUND", readAt: null } } }
            : {}),
          ...(input.needsReplyOnly
            ? { status: "OPEN", muted: false }
            : input.status === undefined
              ? {}
              : { status: input.status }),
          ...(input.cursor === undefined
            ? {}
            : {
                OR: [
                  { lastMessageAt: { lt: input.cursor.lastMessageAt } },
                  {
                    lastMessageAt: input.cursor.lastMessageAt,
                    id: { lt: input.cursor.id },
                  },
                ],
              }),
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: 26,
        include: {
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { body: true, direction: true },
          },
          _count: {
            select: {
              messages: { where: { direction: "INBOUND", readAt: null } },
            },
          },
          jobs: {
            where: { status: { in: ["FAILED", "BLOCKED", "UNKNOWN"] } },
            select: { id: true, kind: true, status: true, errorCode: true },
            take: 5,
          },
        },
      });
      const conversations = rows.slice(0, 25);
      const last = conversations.at(-1);
      const [unreadCount, needsReplyCount] = await Promise.all([
        prisma.supportConversation.count({
          where: { messages: { some: { direction: "INBOUND", readAt: null } } },
        }),
        prisma.supportConversation.count({
          where: {
            status: "OPEN",
            muted: false,
            messages: { some: { direction: "INBOUND" } },
          },
        }),
      ]);
      return {
        conversations,
        unreadCount,
        needsReplyCount,
        nextCursor:
          last !== undefined && rows.length > 25
            ? { lastMessageAt: last.lastMessageAt, id: last.id }
            : undefined,
      };
    }),
  detail: operatorProcedure
    .input(
      ConversationIdSchema.extend({
        cursor: ConversationCursorSchema.optional(),
      }),
    )
    .query(async ({ input }) => {
      const conversation = await prisma.supportConversation.findUnique({
        where: { id: input.id },
      });
      if (conversation === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      const jobs = await prisma.supportJob.findMany({
        where: {
          conversationId: input.id,
          status: { in: ["FAILED", "BLOCKED", "UNKNOWN"] },
        },
        select: { id: true, kind: true, status: true, errorCode: true },
      });
      return {
        conversation,
        jobs,
        ...(await readConversation(input.id, input.cursor)),
      };
    }),
  markRead: operatorMutationProcedure
    .input(
      ConversationIdSchema.extend({ messageId: z.number().int().positive() }),
    )
    .mutation(async ({ input }) => {
      const message = await prisma.feedback.findFirst({
        where: { id: input.messageId, conversationId: input.id },
      });
      if (message === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found.",
        });
      await prisma.$transaction([
        prisma.feedback.updateMany({
          where: {
            conversationId: input.id,
            OR: [
              { createdAt: { lt: message.createdAt } },
              { createdAt: message.createdAt, id: { lte: message.id } },
            ],
          },
          data: { readAt: new Date() },
        }),
        prisma.supportConversation.update({
          where: { id: input.id },
          data: { operatorReadAt: message.createdAt },
        }),
      ]);
      return { read: true };
    }),
  update: operatorMutationProcedure
    .input(
      ConversationIdSchema.extend({
        status: z.enum(["OPEN", "WAITING_ON_USER", "RESOLVED"]).optional(),
        category: z.enum(["HELP", "BUG", "IDEA"]).nullable().optional(),
        muted: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await prisma.$transaction(async (tx) => {
        const candidate = await tx.supportConversation.findUnique({
          where: { id: input.id },
        });
        if (candidate === null)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found.",
          });
        await lockSupportSender(tx, candidate.discordId);
        const conversation = await tx.supportConversation.findUnique({
          where: { id: candidate.id },
        });
        if (conversation === null)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found.",
          });
        return await tx.supportConversation.update({
          where: { id: conversation.id },
          data: {
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.category === undefined
              ? {}
              : { category: input.category }),
            ...(input.muted === undefined ? {} : { muted: input.muted }),
          },
        });
      });
    }),
  reply: operatorMutationProcedure
    .input(
      z.object({
        conversationId: z.uuid(),
        requestId: z.uuid(),
        body: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const reply = await prisma.$transaction(async (tx) => {
        const conversation = await tx.supportConversation.findUnique({
          where: { id: input.conversationId },
        });
        if (conversation === null)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found.",
          });
        await lockSupportSender(tx, conversation.discordId);
        const current = await tx.supportConversation.findUnique({
          where: { id: conversation.id },
        });
        if (current === null)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found.",
          });
        if (current.muted)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unmute this conversation before replying.",
          });
        const existing = await tx.feedbackReply.findUnique({
          where: { id: input.requestId },
          include: { feedback: true },
        });
        if (existing !== null) {
          if (
            existing.operatorDiscordId !== ctx.operator ||
            existing.feedback.conversationId !== conversation.id ||
            existing.body !== input.body
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "This reply request has already been used.",
            });
          return existing;
        }
        const now = new Date();
        const message = await tx.feedback.create({
          data: {
            conversationId: conversation.id,
            discordId: DiscordAccountIdSchema.parse(conversation.discordId),
            body: input.body,
            direction: "OUTBOUND",
            authorDiscordId: ctx.operator,
          },
        });
        const saved = await tx.feedbackReply.create({
          data: {
            id: input.requestId,
            feedbackId: message.id,
            operatorDiscordId: ctx.operator,
            body: input.body,
            status: "QUEUED",
          },
        });
        await tx.supportConversation.update({
          where: { id: conversation.id },
          data: { status: "WAITING_ON_USER", lastMessageAt: now },
        });
        await tx.supportJob.create({
          data: {
            id: `reply:${saved.id}`,
            kind: "REPLY",
            conversationId: conversation.id,
            replyId: saved.id,
          },
        });
        return saved;
      });
      await wakeSupportJobs();
      return reply;
    }),
  retryStorage: operatorMutationProcedure
    .input(z.object({ jobId: z.string().max(100) }))
    .mutation(async ({ input }) => {
      const job = await prisma.supportJob.findFirst({
        where: {
          id: input.jobId,
          kind: { in: ["ARCHIVE", "DELETE_OBJECT"] },
          status: "FAILED",
        },
      });
      if (job === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Failed storage work not found.",
        });
      await prisma.$transaction(async (tx) => {
        if (job.attachmentId !== null)
          await tx.supportAttachment.update({
            where: { id: job.attachmentId },
            data: { status: "PENDING" },
          });
        const queued = await tx.supportJob.updateMany({
          where: { id: job.id, status: "FAILED" },
          data: { status: "QUEUED", attempts: 0, errorCode: null },
        });
        if (queued.count === 0)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Storage work is already being retried.",
          });
      });
      await wakeSupportJobs();
      return { queued: true };
    }),
  deleteConversation: operatorMutationProcedure
    .input(ConversationIdSchema.extend({ confirmation: z.literal("DELETE") }))
    .mutation(async ({ input }) => {
      await deleteSupportConversation(input.id, false);
      await wakeSupportJobs();
      return { deleted: true };
    }),
});
