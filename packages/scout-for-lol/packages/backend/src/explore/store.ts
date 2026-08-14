import { z } from "zod";
import {
  EXPLORE_TITLE_MAX_LENGTH,
  ExploreConversationSchema,
  ExploreMessageSchema,
  ReportAiPreviewSummarySchema,
  VisualizationSnapshotSchema,
  type DiscordAccountId,
  type ExploreAnswer,
  type ExploreConversation,
  type ExploreMessage,
  type ExploreTranscript,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Storage for explore conversations.
 *
 * SQLite has no JSON column type, so the structured parts of a turn (preview
 * rows, visualization snapshot, string arrays) are stored as JSON text and
 * validated with Zod on the way back out. A row that fails to parse is a bug
 * in whatever wrote it, so it throws rather than degrading to an empty turn —
 * a share link silently losing its chart is worse than an error.
 */

const StringArraySchema = z.array(z.string());

type ConversationRow = {
  id: string;
  userId: string;
  title: string;
  shareToken: string | null;
  sharedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  ordinal: number;
  role: string;
  content: string;
  queryText: string | null;
  caveats: string;
  followUps: string;
  preview: string | null;
  visualization: string | null;
  createdAt: Date;
};

function parseJsonColumn<T>(
  raw: string | null,
  schema: z.ZodType<T>,
  column: string,
): T | null {
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Stored explore ${column} does not match its schema: ${result.error.message}`,
    );
  }
  return result.data;
}

function toMessage(row: MessageRow): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: row.id,
    role: row.role,
    ordinal: row.ordinal,
    content: row.content,
    queryText: row.queryText,
    caveats: parseJsonColumn(row.caveats, StringArraySchema, "caveats") ?? [],
    followUps:
      parseJsonColumn(row.followUps, StringArraySchema, "followUps") ?? [],
    preview: parseJsonColumn(
      row.preview,
      ReportAiPreviewSummarySchema,
      "preview",
    ),
    visualization: parseJsonColumn(
      row.visualization,
      VisualizationSnapshotSchema,
      "visualization",
    ),
    createdAt: row.createdAt.toISOString(),
  });
}

function toConversation(row: ConversationRow): ExploreConversation {
  return ExploreConversationSchema.parse({
    id: row.id,
    title: row.title,
    shareToken: row.shareToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Derive a conversation title from its opening question.
 *
 * Titling with the first question rather than asking the model for one keeps
 * a new conversation from costing an extra completion, and the question is
 * usually what the person would have called it anyway.
 */
export function titleFromQuestion(question: string): string {
  const collapsed = question.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length <= EXPLORE_TITLE_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, EXPLORE_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export async function listExploreConversations(
  prisma: ExtendedPrismaClient,
  userId: DiscordAccountId,
): Promise<ExploreConversation[]> {
  const rows = await prisma.exploreConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map((row) => toConversation(row));
}

export async function loadExploreTranscript(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
): Promise<ExploreTranscript | null> {
  const row = await prisma.exploreConversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { ordinal: "asc" } } },
  });
  if (row === null) {
    return null;
  }
  return {
    conversation: toConversation(row),
    messages: row.messages.map((message) => toMessage(message)),
  };
}

/**
 * Load a shared transcript by token. Deliberately not scoped to a user: the
 * token is the credential, and the caller is typically anonymous.
 */
export async function loadSharedExploreTranscript(
  prisma: ExtendedPrismaClient,
  shareToken: string,
): Promise<ExploreTranscript | null> {
  const row = await prisma.exploreConversation.findUnique({
    where: { shareToken },
    include: { messages: { orderBy: { ordinal: "asc" } } },
  });
  if (row === null) {
    return null;
  }
  return {
    conversation: toConversation(row),
    messages: row.messages.map((message) => toMessage(message)),
  };
}

/**
 * Create the conversation if needed and append the user's question.
 *
 * Done before the model runs so the question survives a failed or abandoned
 * turn — a conversation that loses what was asked is not resumable.
 */
export async function startExploreTurn(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string | null;
    userId: DiscordAccountId;
    question: string;
  },
): Promise<{ conversationId: string; title: string; ordinal: number }> {
  if (input.conversationId === null) {
    const title = titleFromQuestion(input.question);
    const created = await prisma.exploreConversation.create({
      data: {
        userId: input.userId,
        title,
        messages: {
          create: {
            ordinal: 0,
            role: "user",
            content: input.question,
          },
        },
      },
    });
    return { conversationId: created.id, title, ordinal: 0 };
  }

  const existing = await prisma.exploreConversation.findFirst({
    where: { id: input.conversationId, userId: input.userId },
    include: { messages: { orderBy: { ordinal: "desc" }, take: 1 } },
  });
  if (existing === null) {
    throw new Error("Conversation not found.");
  }
  const ordinal = (existing.messages[0]?.ordinal ?? -1) + 1;
  await prisma.exploreMessage.create({
    data: {
      conversationId: existing.id,
      ordinal,
      role: "user",
      content: input.question,
    },
  });
  return { conversationId: existing.id, title: existing.title, ordinal };
}

export async function appendExploreAnswer(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    ordinal: number;
    answer: ExploreAnswer;
    preview: ReportAiPreviewSummary | null;
    visualization: VisualizationSnapshot | null;
  },
): Promise<ExploreMessage> {
  const row = await prisma.exploreMessage.create({
    data: {
      conversationId: input.conversationId,
      ordinal: input.ordinal,
      role: "assistant",
      content: input.answer.answer,
      queryText: input.answer.queryText,
      caveats: JSON.stringify(input.answer.caveats),
      followUps: JSON.stringify(input.answer.followUps),
      preview: input.preview === null ? null : JSON.stringify(input.preview),
      visualization:
        input.visualization === null
          ? null
          : JSON.stringify(input.visualization),
    },
  });
  // Touch the conversation so the sidebar orders by real activity.
  await prisma.exploreConversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
  });
  return toMessage(row);
}

export async function deleteExploreConversation(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
): Promise<boolean> {
  const result = await prisma.exploreConversation.deleteMany({
    where: { id: conversationId, userId },
  });
  return result.count > 0;
}

export async function renameExploreConversation(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
  title: string,
): Promise<boolean> {
  const result = await prisma.exploreConversation.updateMany({
    where: { id: conversationId, userId },
    data: { title },
  });
  return result.count > 0;
}

/**
 * Mint a share token, or return the existing one.
 *
 * Re-sharing keeps the same token so a link already sent to someone does not
 * break. Revoking and re-sharing deliberately mints a new one.
 */
export async function shareExploreConversation(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
): Promise<string | null> {
  const existing = await prisma.exploreConversation.findFirst({
    where: { id: conversationId, userId },
    select: { shareToken: true },
  });
  if (existing === null) {
    return null;
  }
  if (existing.shareToken !== null) {
    return existing.shareToken;
  }
  const shareToken = globalThis.crypto.randomUUID().replaceAll("-", "");
  await prisma.exploreConversation.updateMany({
    where: { id: conversationId, userId },
    data: { shareToken, sharedAt: new Date() },
  });
  return shareToken;
}

export async function revokeExploreShare(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
): Promise<boolean> {
  const result = await prisma.exploreConversation.updateMany({
    where: { id: conversationId, userId },
    data: { shareToken: null, sharedAt: null },
  });
  return result.count > 0;
}
