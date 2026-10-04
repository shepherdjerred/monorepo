import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import type {
  FeedbackSource,
  SupportConversation,
} from "#generated/prisma/client/index.js";
import { isScoutOperator } from "#src/operations/operator-allowlist.ts";
import configuration from "#src/configuration.ts";
import {
  lockSupportSender as lockSupportSenderForTx,
  readSupportSenderThrottle,
  writeSupportSenderThrottle,
  type SupportSenderThrottleState,
} from "#src/support/sender-throttle.ts";

export async function lockSupportSender(
  tx: Db,
  discordId: string,
): Promise<void> {
  await lockSupportSenderForTx(tx, discordId);
}

export const SupportContextSchema = z.strictObject({
  page: z
    .string()
    .max(300)
    .regex(/^\/app\/[\w./%-]*$/)
    .optional(),
  matchId: z
    .string()
    .max(100)
    .regex(/^[A-Z0-9]+_\d+$/)
    .optional(),
  serverId: DiscordGuildIdSchema.optional(),
});
const StoredSupportContextSchema = SupportContextSchema.extend({
  revision: z.string().optional(),
});
export const SupportMessageSchema = z
  .object({
    body: z.string().trim().max(4000),
    submissionId: z.uuid().optional(),
    attachmentIds: z.array(z.uuid()).max(5).default([]),
    context: SupportContextSchema.default({}),
  })
  .refine((input) => input.body.length > 0 || input.attachmentIds.length > 0, {
    message: "Write a message or attach a screenshot.",
    path: ["body"],
  });

/** Also adopts records written by an older pod during a rolling upgrade. */
export async function ensureConversation(
  tx: Db,
  discordId: string,
  username?: string,
) {
  const conversation = await tx.supportConversation.upsert({
    where: { discordId },
    create: {
      discordId: DiscordAccountIdSchema.parse(discordId),
      username: username ?? null,
    },
    update: username === undefined ? {} : { username },
  });
  await tx.feedback.updateMany({
    where: {
      discordId: DiscordAccountIdSchema.parse(discordId),
      conversationId: null,
    },
    data: { conversationId: conversation.id },
  });
  return conversation;
}

type SupportIntake = {
  discordId: string;
  username?: string;
  body: string;
  source: FeedbackSource;
  submissionId?: string;
  discordMessageId?: string;
  discordChannelId?: string;
  attachmentIds?: string[];
  context?: z.infer<typeof SupportContextSchema>;
  rating?: number;
  createdAt?: Date;
  discordAttachments?: {
    name: string;
    url: string;
    size: number;
    contentType: string;
  }[];
};

async function replaySupportMessage(
  tx: Db,
  input: SupportIntake,
  conversationId: string,
) {
  const findExisting = async () => {
    if (input.submissionId !== undefined)
      return await tx.feedback.findUnique({
        where: { submissionId: input.submissionId },
      });
    if (input.discordMessageId !== undefined)
      return await tx.feedback.findUnique({
        where: { discordMessageId: input.discordMessageId },
      });
    return null;
  };
  const existing = await findExisting();
  if (existing === null) return null;
  const storedContext = StoredSupportContextSchema.parse(existing.context);
  const requestedContext = SupportContextSchema.parse(input.context ?? {});
  const existingFiles = await tx.supportAttachment.findMany({
    where: { feedbackId: existing.id },
    select: { id: true },
  });
  const stored = [
    existing.discordId,
    existing.body,
    existing.source,
    existing.rating,
    existing.serverId,
    storedContext.page,
    storedContext.matchId,
    existing.source === "WEB"
      ? existingFiles.map((file) => file.id).sort()
      : null,
  ];
  const requested = [
    input.discordId,
    input.body,
    input.source,
    input.rating ?? null,
    requestedContext.serverId ?? null,
    requestedContext.page,
    requestedContext.matchId,
    input.source === "WEB" ? [...(input.attachmentIds ?? [])].sort() : null,
  ];
  if (JSON.stringify(stored) !== JSON.stringify(requested))
    throw new TRPCError({
      code: "CONFLICT",
      message: "This submission has already been used.",
    });
  return { id: existing.id, conversationId, inserted: false };
}

async function validateSupportIntake(
  tx: Db,
  input: SupportIntake,
  conversation: SupportConversation,
  now: Date,
): Promise<SupportSenderThrottleState> {
  if (conversation.muted)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This conversation is muted. You cannot send another message right now.",
    });
  const cutoff = new Date(now.getTime() - 60_000);
  const throttle = await readSupportSenderThrottle(tx, input.discordId);
  const recent = throttle.inboundAt.filter((createdAt) => createdAt >= cutoff);
  if (recent.length >= 10)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Please wait a minute before sending more messages.",
    });
  const ids = input.attachmentIds ?? [];
  if (new Set(ids).size !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A screenshot cannot be attached twice.",
    });
  const screenshots = await tx.supportAttachment.count({
    where: {
      id: { in: ids },
      conversationId: conversation.id,
      feedbackId: null,
      status: "STORED",
    },
  });
  if (screenshots !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A screenshot is not ready or does not belong to you.",
    });
  return {
    ...throttle,
    inboundAt: recent,
    uploadAt: throttle.uploadAt.filter((createdAt) => createdAt >= cutoff),
  };
}

async function createInboundMessage(
  tx: Db,
  input: SupportIntake,
  conversationId: string,
  now: Date,
) {
  const context = SupportContextSchema.parse(input.context ?? {});
  return await tx.feedback.create({
    data: {
      discordId: DiscordAccountIdSchema.parse(input.discordId),
      discordUsername: input.username ?? null,
      conversationId: conversationId,
      body: input.body,
      source: input.source,
      submissionId: input.submissionId ?? null,
      discordMessageId: input.discordMessageId ?? null,
      discordChannelId: input.discordChannelId ?? null,
      serverId: context.serverId ?? null,
      rating: input.rating ?? null,
      createdAt: input.createdAt ?? now,
      context: { ...context, revision: configuration.gitSha },
    },
  });
}

async function attachSupportScreenshots(
  tx: Db,
  input: SupportIntake,
  conversationId: string,
  messageId: number,
) {
  const ids = input.attachmentIds ?? [];
  if (ids.length > 0)
    await tx.supportAttachment.updateMany({
      where: {
        id: { in: ids },
        conversationId: conversationId,
        feedbackId: null,
      },
      data: { feedbackId: messageId },
    });
  for (const file of input.discordAttachments ?? []) {
    const id = crypto.randomUUID();
    await tx.supportAttachment.create({
      data: {
        id,
        conversationId: conversationId,
        feedbackId: messageId,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
        sourceUrl: file.url,
        objectKey: `${conversationId}/${id}`,
      },
    });
    await tx.supportJob.create({
      data: {
        id: `archive:${id}`,
        kind: "ARCHIVE",
        conversationId: conversationId,
        attachmentId: id,
      },
    });
  }
}

async function finishSupportIntake(
  tx: Db,
  input: SupportIntake,
  conversation: SupportConversation,
  {
    messageId,
    now,
    throttle,
  }: { messageId: number; now: Date; throttle: SupportSenderThrottleState },
) {
  const context = SupportContextSchema.parse(input.context ?? {});
  const alert =
    !isScoutOperator(input.discordId) &&
    (throttle.lastAlertAt === null ||
      now.getTime() - throttle.lastAlertAt.getTime() >= 300_000);
  const receipt =
    input.source === "DISCORD_DM" &&
    (throttle.lastReceiptAt === null ||
      now.getTime() - throttle.lastReceiptAt.getTime() >= 300_000);
  await writeSupportSenderThrottle(tx, input.discordId, {
    ...throttle,
    inboundAt: [...throttle.inboundAt, now],
    lastAlertAt: alert ? now : throttle.lastAlertAt,
    lastReceiptAt: receipt ? now : throttle.lastReceiptAt,
  });
  await tx.supportConversation.update({
    where: { id: conversation.id },
    data: {
      status: "OPEN",
      lastMessageAt: now,
      ...(alert ? { lastAlertAt: now } : {}),
      ...(receipt ? { lastReceiptAt: now } : {}),
    },
  });
  if (alert)
    await tx.supportJob.create({
      data: {
        id: `alert:${messageId.toString()}`,
        kind: "ALERT",
        conversationId: conversation.id,
      },
    });
  if (receipt)
    await tx.supportJob.create({
      data: {
        id: `receipt:${messageId.toString()}`,
        kind: "ACKNOWLEDGEMENT",
        conversationId: conversation.id,
      },
    });
  if (input.source === "WEB")
    await tx.feedbackPromptState.upsert({
      where: { discordId: DiscordAccountIdSchema.parse(input.discordId) },
      create: {
        discordId: DiscordAccountIdSchema.parse(input.discordId),
        submitted: true,
      },
      update: { submitted: true },
    });
  if (input.source === "DISCORD_MODAL" && !isScoutOperator(input.discordId))
    await tx.supportTouchpoint.createMany({
      data: {
        id: `submitted:${z.string().parse(input.discordMessageId)}`,
        surface: context.matchId === undefined ? "HELP" : "REPORT",
        action: "SUBMITTED",
      },
      skipDuplicates: true,
    });
}

export async function acceptSupportMessage(
  input: SupportIntake,
  db: ExtendedPrismaClient = prisma,
) {
  return await db.$transaction(async (tx) => {
    await lockSupportSender(tx, input.discordId);
    const conversation = await ensureConversation(
      tx,
      input.discordId,
      input.username,
    );
    const replay = await replaySupportMessage(tx, input, conversation.id);
    if (replay !== null) return replay;
    const now = new Date();
    const throttle = await validateSupportIntake(tx, input, conversation, now);
    const message = await createInboundMessage(tx, input, conversation.id, now);
    await attachSupportScreenshots(tx, input, conversation.id, message.id);
    await finishSupportIntake(tx, input, conversation, {
      messageId: message.id,
      now,
      throttle,
    });
    return { id: message.id, conversationId: conversation.id, inserted: true };
  });
}

export const ConversationCursorSchema = z.object({
  createdAt: z.coerce.date(),
  id: z.number().int().positive(),
});
const SupportMessageViewSchema = z.object({
  id: z.number().int(),
  body: z.string(),
  source: z.enum(["WEB", "DISCORD_DM", "DISCORD_MODAL"]),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  createdAt: z.date(),
  context: StoredSupportContextSchema,
  screenshots: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      size: z.number().int(),
      contentType: z.string(),
      status: z.enum(["PENDING", "STORED", "FAILED"]),
    }),
  ),
  replies: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["QUEUED", "SENDING", "SENT", "FAILED", "DM_DISABLED"]),
    }),
  ),
});

export async function readConversation(
  id: string,
  cursor?: z.infer<typeof ConversationCursorSchema>,
) {
  const rows = await prisma.feedback.findMany({
    where: {
      conversationId: id,
      ...(cursor === undefined
        ? {}
        : {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    select: {
      id: true,
      body: true,
      source: true,
      direction: true,
      createdAt: true,
      context: true,
      screenshots: {
        select: {
          id: true,
          name: true,
          size: true,
          status: true,
          contentType: true,
        },
      },
      replies: {
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  const messages = z.array(SupportMessageViewSchema).parse(rows.slice(0, 50));
  const last = messages.at(-1);
  return {
    messages: messages.reverse(),
    nextCursor:
      last !== undefined && rows.length > 50
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

/** Queue object removal before cascading DB deletion; jobs never hold bodies. */
export async function deleteSupportConversation(
  id: string,
  preserveMute = true,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const conversation = await tx.supportConversation.findUnique({
      where: { id },
    });
    if (conversation === null) return;
    await lockSupportSender(tx, conversation.discordId);
    const files = await tx.supportAttachment.findMany({
      where: { conversationId: id },
      select: { id: true, objectKey: true },
    });
    for (const file of files)
      await tx.supportJob.upsert({
        where: { id: `delete:${file.id}` },
        create: {
          id: `delete:${file.id}`,
          kind: "DELETE_OBJECT",
          objectKey: file.objectKey,
        },
        update: {},
      });
    if (preserveMute && conversation.muted) {
      // Deleting message contents must not let an abusive sender reset a mute.
      await tx.supportJob.updateMany({
        where: { conversationId: id, status: "QUEUED" },
        data: { status: "SKIPPED" },
      });
      await tx.supportAttachment.deleteMany({ where: { conversationId: id } });
      await tx.feedback.deleteMany({ where: { conversationId: id } });
      await tx.supportConversation.update({
        where: { id },
        data: {
          category: null,
          username: null,
          status: "RESOLVED",
          lastAlertAt: null,
          lastReceiptAt: null,
          operatorReadAt: null,
          userReadAt: null,
          userReadMessageId: 0,
        },
      });
    } else await tx.supportConversation.delete({ where: { id } });
    await tx.supportJob.updateMany({
      where: {
        conversationId: null,
        kind: { not: "DELETE_OBJECT" },
        status: "QUEUED",
      },
      data: { status: "SKIPPED" },
    });
  });
}
