import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { router, webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import { prisma } from "#src/database/index.ts";
import { feedbackSubmittedTotal } from "#src/metrics/platform/web.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  acceptSupportMessage,
  ConversationCursorSchema,
  deleteSupportConversation,
  lockSupportSender,
  readConversation,
  SupportMessageSchema,
} from "#src/support/conversations.ts";
import {
  ScreenshotUploadSchema,
  uploadScreenshot,
} from "#src/support/screenshots.ts";
import { wakeSupportJobs } from "#src/support/jobs.ts";

export const feedbackRouter = router({
  unread: webProcedure.query(async ({ ctx }) => {
    const conversation = await prisma.supportConversation.findUnique({
      where: { discordId: ctx.user.discordId },
    });
    if (conversation === null) return { count: 0 };
    return {
      count: await prisma.feedback.count({
        where: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
          ...(conversation.userReadAt === null
            ? {}
            : {
                OR: [
                  { createdAt: { gt: conversation.userReadAt } },
                  {
                    createdAt: conversation.userReadAt,
                    id: { gt: conversation.userReadMessageId },
                  },
                ],
              }),
        },
      }),
    };
  }),
  features: webProcedure.query(async () => ({
    conversations: await isPolicyEnabled("scout_support_conversations_enabled"),
  })),
  eligibility: webProcedure.query(async ({ ctx }) => {
    const [created, promptState] = await Promise.all([
      prisma.subscription.count({
        where: { creatorDiscordId: ctx.user.discordId },
      }),
      prisma.feedbackPromptState.findUnique({
        where: { discordId: ctx.user.discordId },
      }),
    ]);
    return { shouldAsk: created > 0 && promptState === null };
  }),
  dismiss: webMutationProcedure.mutation(async ({ ctx }) => {
    await prisma.feedbackPromptState.upsert({
      where: { discordId: ctx.user.discordId },
      create: { discordId: ctx.user.discordId, submitted: false },
      update: {},
    });
    return { dismissed: true };
  }),
  submit: webMutationProcedure
    .input(
      SupportMessageSchema.and(
        z.object({
          rating: z.number().int().min(1).max(5).optional(),
          serverId: DiscordGuildIdSchema.optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const saved = await acceptSupportMessage({
        discordId: ctx.user.discordId,
        username: ctx.user.discordUsername,
        body: input.body,
        source: "WEB",
        ...(input.submissionId === undefined
          ? {}
          : { submissionId: input.submissionId }),
        attachmentIds: input.attachmentIds,
        context: {
          ...input.context,
          ...(input.serverId === undefined ? {} : { serverId: input.serverId }),
        },
        ...(input.rating === undefined ? {} : { rating: input.rating }),
      });
      if (saved.inserted)
        feedbackSubmittedTotal.inc({
          rated: input.rating === undefined ? "no" : "yes",
        });
      await wakeSupportJobs();
      return { id: saved.id, conversationId: saved.conversationId };
    }),
  conversation: webProcedure
    .input(z.object({ cursor: ConversationCursorSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conversation = await prisma.supportConversation.findUnique({
        where: { discordId: ctx.user.discordId },
      });
      if (conversation === null)
        return { conversation: null, messages: [], nextCursor: null };
      return {
        conversation: {
          id: conversation.id,
          status: conversation.status,
          muted: conversation.muted,
          userReadAt: conversation.userReadAt,
        },
        ...(await readConversation(conversation.id, input?.cursor)),
      };
    }),
  markRead: webMutationProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const message = await prisma.feedback.findFirst({
        where: { id: input.messageId, discordId: ctx.user.discordId },
      });
      if (message?.conversationId == null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found.",
        });
      await prisma.supportConversation.updateMany({
        where: {
          id: message.conversationId,
          OR: [
            { userReadAt: null },
            { userReadAt: { lt: message.createdAt } },
            {
              userReadAt: message.createdAt,
              userReadMessageId: { lt: message.id },
            },
          ],
        },
        data: { userReadAt: message.createdAt, userReadMessageId: message.id },
      });
      return { read: true };
    }),
  uploadScreenshot: webMutationProcedure
    .input(ScreenshotUploadSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await isPolicyEnabled("scout_support_conversations_enabled")))
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Screenshot uploads are not available yet.",
        });
      return await uploadScreenshot(ctx.user.discordId, input);
    }),
  retryScreenshot: webMutationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const file = await prisma.supportAttachment.findFirst({
        where: {
          id: input.id,
          conversation: { discordId: ctx.user.discordId },
          status: "FAILED",
          sourceUrl: { not: null },
        },
      });
      if (file === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Failed screenshot not found. Please upload it again.",
        });
      await prisma.$transaction([
        prisma.supportAttachment.update({
          where: { id: file.id },
          data: { status: "PENDING" },
        }),
        prisma.supportJob.update({
          where: { id: `archive:${file.id}` },
          data: { status: "QUEUED", attempts: 0, errorCode: null },
        }),
      ]);
      await wakeSupportJobs();
      return { queued: true };
    }),
  removeScreenshot: webMutationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await prisma.$transaction(async (tx) => {
        await lockSupportSender(tx, ctx.user.discordId);
        const file = await tx.supportAttachment.findUnique({
          where: { id: input.id },
          include: { conversation: { select: { discordId: true } } },
        });
        if (file === null) return { removed: true, saved: false };
        if (file.conversation.discordId !== ctx.user.discordId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Unsubmitted screenshot not found.",
          });
        // Discarding an ambiguous draft cannot delete an already accepted file.
        if (file.feedbackId !== null) return { removed: false, saved: true };
        await tx.supportJob.upsert({
          where: { id: `delete:${file.id}` },
          create: {
            id: `delete:${file.id}`,
            kind: "DELETE_OBJECT",
            objectKey: file.objectKey,
          },
          update: {},
        });
        await tx.supportAttachment.delete({ where: { id: file.id } });
        return { removed: true, saved: false };
      });
      await wakeSupportJobs();
      return result;
    }),
  deleteConversation: webMutationProcedure
    .input(z.object({ confirmation: z.literal("DELETE") }))
    .mutation(async ({ ctx }) => {
      const conversation = await prisma.supportConversation.findUnique({
        where: { discordId: ctx.user.discordId },
      });
      if (conversation !== null)
        await deleteSupportConversation(conversation.id);
      await wakeSupportJobs();
      return { deleted: true };
    }),
});
