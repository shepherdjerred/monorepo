import { z } from "zod";
import {
  EXPLORE_TITLE_MAX_LENGTH,
  ExploreConversationSchema,
  ExploreMessageSchema,
  ExploreTraceEntrySchema,
  ReportAiPreviewSummarySchema,
  VisualizationSnapshotSchema,
  type DiscordAccountId,
  type ExploreAnswer,
  type ExploreAttachPoint,
  type ExploreConversation,
  type ExploreMessage,
  type ExploreTraceEntry,
  type ExploreTranscript,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  deepestLeafFrom,
  pathToLeaf,
  siblingsOf,
  versionPosition,
} from "#src/explore/tree.ts";

/**
 * Storage for explore conversations.
 *
 * Turns form a tree (see tree.ts); this module is the boundary between that
 * tree and Prisma. Two rules hold throughout:
 *
 * - **Nothing is ever deleted to make room for a new version.** Editing or
 *   regenerating appends a sibling, so every earlier answer stays reachable.
 * - **Every read and write is owner-scoped.** ExploreMessage has no userId, so
 *   scoping goes through the conversation relation rather than being assumed
 *   from a caller that already looked the conversation up.
 *
 * SQLite has no JSON column type, so the structured parts of a turn are stored
 * as JSON text and validated with Zod on the way back out. A row that fails to
 * parse is a bug in whatever wrote it, so it throws rather than degrading to
 * an empty turn — a share link silently losing its chart is worse than an
 * error.
 */

const StringArraySchema = z.array(z.string());
const TraceArraySchema = z.array(ExploreTraceEntrySchema);

/**
 * The conversation or message a turn refers to does not exist, or is not the
 * caller's. Separate from {@link ExploreInvalidTurnError} and from an
 * unexpected fault so the HTTP surface can answer 404, 400, and 500 apart
 * rather than reporting a database outage as a missing conversation.
 */
export class ExploreNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExploreNotFoundError";
  }
}

/** The turn refers to real rows but asks for something incoherent of them. */
export class ExploreInvalidTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExploreInvalidTurnError";
  }
}

type ConversationRow = {
  id: string;
  title: string;
  shareToken: string | null;
  sharedLeafId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRow = {
  id: string;
  parentId: string | null;
  role: string;
  content: string;
  queryText: string | null;
  caveats: string;
  followUps: string;
  preview: string | null;
  visualization: string | null;
  trace: string | null;
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

export function toMessage(
  row: MessageRow,
  versions: { siblingIds: string[]; index: number; count: number },
): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: row.id,
    role: row.role,
    parentId: row.parentId,
    siblingIds: versions.siblingIds,
    versionIndex: versions.index,
    versionCount: versions.count,
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
    trace: parseJsonColumn(row.trace, TraceArraySchema, "trace") ?? [],
    createdAt: row.createdAt.toISOString(),
  });
}

function toConversation(row: ConversationRow): ExploreConversation {
  return ExploreConversationSchema.parse({
    id: row.id,
    title: row.title,
    shareToken: row.shareToken,
    sharedLeafId: row.sharedLeafId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Position and sibling ids, derived together so they cannot disagree. */
export function versionsOf(
  nodes: { id: string; parentId: string | null; createdAt: Date }[],
  messageId: string,
): { siblingIds: string[]; index: number; count: number } {
  const position = versionPosition(nodes, messageId);
  return {
    siblingIds: siblingsOf(nodes, messageId).map((sibling) => sibling.id),
    index: position.index,
    count: position.count,
  };
}

/**
 * Turn a loaded conversation into the transcript for one path.
 *
 * Every message of the conversation is loaded, not just the path — sibling
 * counts for the version arrows need the whole tree, and a conversation is
 * small enough that one query beats one per level.
 */
function buildTranscript(
  conversation: ConversationRow,
  rows: MessageRow[],
  leafId: string | null,
): ExploreTranscript {
  const resolvedLeaf = leafId ?? deepestLeafFrom(rows, null);
  const path = pathToLeaf(rows, resolvedLeaf);
  return {
    conversation: toConversation(conversation),
    messages: path.map((row) => toMessage(row, versionsOf(rows, row.id))),
  };
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
  /**
   * Render this path instead of the reader's current one. Used while a turn
   * is running to assemble the history leading to the question being answered,
   * which for an edit or a regenerate is not the branch on screen.
   */
  leafIdOverride?: string,
): Promise<ExploreTranscript | null> {
  const row = await prisma.exploreConversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: true },
  });
  if (row === null) {
    return null;
  }
  return buildTranscript(
    row,
    row.messages,
    leafIdOverride ?? row.currentLeafId,
  );
}

/**
 * Load a shared transcript by token. Deliberately not scoped to a user: the
 * token is the credential, and the caller is typically anonymous.
 *
 * Renders `sharedLeafId` — the path pinned when the link was created — so the
 * owner branching afterwards cannot change what a recipient sees.
 */
export async function loadSharedExploreTranscript(
  prisma: ExtendedPrismaClient,
  shareToken: string,
): Promise<ExploreTranscript | null> {
  const row = await prisma.exploreConversation.findUnique({
    where: { shareToken },
    include: { messages: true },
  });
  if (row === null) {
    return null;
  }
  return buildTranscript(row, row.messages, row.sharedLeafId);
}

/**
 * Create the conversation if needed and append the user's question.
 * Saved before the model runs so a failed turn never loses its question.
 *
 * `attach` decides where the question lands: `leaf` continues the branch on
 * screen, `message` forks a sibling under a named parent (how editing works),
 * and `root` forks the opening question itself — the one fork a parent id
 * cannot express, because the root's parent is null.
 */
export async function startExploreTurn(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string | null;
    newId?: string;
    userId: DiscordAccountId;
    question: string;
    attach: ExploreAttachPoint;
  },
): Promise<{
  conversationId: string;
  title: string;
  messageId: string;
  expectedCurrentLeafId: string | null;
}> {
  if (input.conversationId === null) {
    const created = await prisma.exploreConversation.create({
      data: {
        ...(input.newId === undefined ? {} : { id: input.newId }),
        userId: input.userId,
        title: titleFromQuestion(input.question),
        messages: { create: { role: "user", content: input.question } },
      },
      include: { messages: true },
    });
    const messageId = created.messages[0]?.id;
    if (messageId === undefined) {
      throw new Error("Conversation was created without its first message.");
    }
    return {
      conversationId: created.id,
      title: created.title,
      messageId,
      expectedCurrentLeafId: null,
    };
  }
  const existing = await prisma.exploreConversation.findFirst({
    where: { id: input.conversationId, userId: input.userId },
    include: { messages: true },
  });
  if (existing === null) {
    throw new ExploreNotFoundError("Conversation not found.");
  }

  // `root` forks the opening question (a new root sibling needs no ownership
  // check — there is no parent to own); `message` must name a row in this
  // conversation; `leaf` resolves from the conversation's own pointer.
  const parentId =
    input.attach.kind === "leaf"
      ? deepestLeafFrom(existing.messages, existing.currentLeafId)
      : input.attach.kind === "root"
        ? null
        : input.attach.messageId;
  // Whichever attach point produced it, a parent must be a row in THIS
  // conversation. `message` names one directly. `leaf` resolves
  // `currentLeafId`, and `deepestLeafFrom` returns that pointer unchanged when
  // nothing descends from it — without checking it is a node at all — so a
  // stale pointer resolves to itself.
  //
  // The tree is not at risk: `parentId` carries a real foreign key
  // (`ExploreMessage_parentId_fkey`, with `PRAGMA foreign_keys=ON`), so the row
  // is refused rather than written. What the check buys is the right error. An
  // unguarded stale pointer raises a raw Prisma constraint violation, which is
  // neither of the errors this module classifies, so the route's catch-all
  // answers 500 — a fault on our side — for what is only a parent that does not
  // exist. Checking here makes it the 404 it always was.
  //
  // Deliberately strict here and lenient in `buildTranscript`, which resolves
  // the same pointer for reading: a stale pointer should still render a
  // conversation, but it must not be able to author into one.
  if (
    parentId !== null &&
    !existing.messages.some((message) => message.id === parentId)
  ) {
    throw new ExploreNotFoundError("Message not found.");
  }

  const created = await prisma.exploreMessage.create({
    data: {
      conversationId: existing.id,
      parentId,
      role: "user",
      content: input.question,
    },
  });
  // Move the branch onto the question straight away, which is what makes
  // persisting it before the model runs worth anything: the transcript is read
  // by `currentLeafId`, so a turn that dies before its answer would otherwise
  // leave the question in the database but off the path — invisible to the
  // person who just asked it. For an edit this is also the switch onto the
  // branch they just created.
  //
  // A brand-new conversation needs no equivalent: its `currentLeafId` is null
  // and `buildTranscript` falls back to the deepest leaf, which is the
  // question.
  await prisma.exploreConversation.update({
    where: { id: existing.id },
    data: { currentLeafId: created.id, updatedAt: new Date() },
  });
  return {
    conversationId: existing.id,
    title: existing.title,
    messageId: created.id,
    expectedCurrentLeafId: created.id,
  };
}

/**
 * Resolve the user message a regenerate should answer again.
 *
 * Regenerating adds a new assistant sibling under an existing question rather
 * than duplicating the question, which is what puts the version arrows on the
 * answer where a reader expects them.
 */
export async function resolveRegenerateTarget(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    userId: DiscordAccountId;
    parentMessageId: string;
  },
): Promise<{
  conversationId: string;
  title: string;
  messageId: string;
  question: string;
  expectedCurrentLeafId: string | null;
}> {
  const existing = await prisma.exploreConversation.findFirst({
    where: { id: input.conversationId, userId: input.userId },
    include: { messages: true },
  });
  if (existing === null) {
    throw new ExploreNotFoundError("Conversation not found.");
  }
  const parent = existing.messages.find(
    (message) => message.id === input.parentMessageId,
  );
  if (parent === undefined) {
    throw new ExploreNotFoundError("Message not found.");
  }
  if (parent.role !== "user") {
    throw new ExploreInvalidTurnError("Only a question can be answered again.");
  }
  return {
    conversationId: existing.id,
    title: existing.title,
    messageId: parent.id,
    question: parent.content,
    expectedCurrentLeafId: existing.currentLeafId,
  };
}

export async function appendExploreAnswer(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    parentMessageId: string;
    answer: ExploreAnswer;
    preview: ReportAiPreviewSummary | null;
    visualization: VisualizationSnapshot | null;
    trace: ExploreTraceEntry[];
    /**
     * Move the visible branch only if it still names the leaf this run began
     * from. A background answer must not yank another tab away from a version
     * the reader selected while the model was working.
     */
    expectedCurrentLeafId?: string | null;
  },
): Promise<ExploreMessage> {
  const row = await prisma.exploreMessage.create({
    data: {
      conversationId: input.conversationId,
      parentId: input.parentMessageId,
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
      trace: JSON.stringify(input.trace),
    },
  });
  // The new answer becomes the branch the owner is reading, and the touch
  // reorders the sidebar by real activity.
  if ("expectedCurrentLeafId" in input) {
    await prisma.exploreConversation.updateMany({
      where: {
        id: input.conversationId,
        currentLeafId: input.expectedCurrentLeafId,
      },
      data: { currentLeafId: row.id, updatedAt: new Date() },
    });
  } else {
    await prisma.exploreConversation.update({
      where: { id: input.conversationId },
      data: { currentLeafId: row.id, updatedAt: new Date() },
    });
  }

  const siblings = await prisma.exploreMessage.findMany({
    where: { conversationId: input.conversationId },
    select: { id: true, parentId: true, createdAt: true },
  });
  return toMessage(row, versionsOf(siblings, row.id));
}

/**
 * Switch which branch the owner is reading.
 *
 * Selecting a version follows it down to its own leaf rather than stopping at
 * the version itself — otherwise choosing an older question would hide the
 * answer that came after it.
 */
export async function setExploreLeaf(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
  messageId: string,
): Promise<boolean> {
  const existing = await prisma.exploreConversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: { select: { id: true, parentId: true, createdAt: true } },
    },
  });
  if (existing === null) {
    return false;
  }
  if (!existing.messages.some((message) => message.id === messageId)) {
    return false;
  }
  await prisma.exploreConversation.update({
    where: { id: conversationId },
    data: { currentLeafId: deepestLeafFrom(existing.messages, messageId) },
  });
  return true;
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

/**
 * Replace the placeholder title with the one the agent produced.
 *
 * `titleFromQuestion` gives a conversation a name the instant it exists, so
 * the sidebar is never blank while the first turn streams; this swaps in the
 * model's summary once that turn finishes. The agent already runs structured
 * output, so the title rides along with the answer and costs no extra
 * completion — and it is written having seen the whole first exchange rather
 * than the question alone.
 *
 * Conditioned on the placeholder still being in place, in one statement rather
 * than a read-then-write: that makes it self-limiting to the first turn and
 * makes it impossible to clobber a rename, without either check racing.
 *
 * The placeholder is derived here rather than taken from the caller, and that
 * is the whole guard. A caller holding "the conversation's title" holds the
 * placeholder only on the very first turn; on every later one it holds whatever
 * the title has since become, so passing it in made the predicate compare a
 * value to itself and match unconditionally — replacing established generated
 * titles and manual renames alike. Recomputing it from the opening question
 * leaves no way to ask the wrong question.
 */
export async function applyGeneratedTitle(
  prisma: ExtendedPrismaClient,
  input: { conversationId: string; title: string },
): Promise<string> {
  const conversation = await prisma.exploreConversation.findUnique({
    where: { id: input.conversationId },
    include: {
      // The earliest root is the question `startExploreTurn` named the
      // conversation after. Editing the opening question forks a *sibling*
      // root rather than replacing it, so ordering matters.
      messages: {
        where: { parentId: null, role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (conversation === null) {
    throw new ExploreNotFoundError("Conversation not found.");
  }
  const opening = conversation.messages[0];
  if (opening === undefined) {
    throw new Error(
      `Explore conversation ${input.conversationId} has no opening question.`,
    );
  }
  const placeholder = titleFromQuestion(opening.content);
  const title = titleFromQuestion(input.title);
  if (title === placeholder || title.length === 0) {
    return conversation.title;
  }
  const result = await prisma.exploreConversation.updateMany({
    where: { id: input.conversationId, title: placeholder },
    data: { title },
  });
  return result.count > 0 ? title : conversation.title;
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
 * break, and re-pins it to whatever the owner is reading now. Revoking and
 * re-sharing deliberately mints a new one.
 */
export async function shareExploreConversation(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
): Promise<string | null> {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.exploreConversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        messages: { select: { id: true, parentId: true, createdAt: true } },
      },
    });
    if (existing === null) {
      return null;
    }
    const sharedLeafId = deepestLeafFrom(
      existing.messages,
      existing.currentLeafId,
    );
    const shareToken =
      existing.shareToken ?? globalThis.crypto.randomUUID().replaceAll("-", "");
    const updated = await tx.exploreConversation.updateMany({
      where: { id: conversationId, userId },
      data: { shareToken, sharedLeafId, sharedAt: new Date() },
    });
    // The token is only real once the row carries it. Returning one from an
    // update that matched nothing — the conversation deleted in between —
    // would hand the owner a link that can only ever 404.
    if (updated.count === 0) {
      return null;
    }
    return shareToken;
  });
}

export async function revokeExploreShare(
  prisma: ExtendedPrismaClient,
  conversationId: string,
  userId: DiscordAccountId,
): Promise<boolean> {
  const result = await prisma.exploreConversation.updateMany({
    where: { id: conversationId, userId },
    data: { shareToken: null, sharedLeafId: null, sharedAt: null },
  });
  return result.count > 0;
}
