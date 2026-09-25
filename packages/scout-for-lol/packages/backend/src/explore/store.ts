import {
  EXPLORE_TITLE_MAX_LENGTH,
  type DiscordAccountId,
  type ExploreAnswer,
  type ExploreAttachPoint,
  type ExploreConversation,
  type ExploreMessage,
  type ExploreMatchCard,
  type ExploreTraceEntry,
  type ExploreTranscript,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  buildTranscript,
  toConversation,
  toMessage,
  versionsOf,
} from "#src/explore/store-mappers.ts";
import { deepestLeafFrom } from "#src/explore/tree.ts";

export type ExploreTurnStoreClient = Pick<
  ExtendedPrismaClient,
  "exploreConversation" | "exploreMessage"
>;

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

/**
 * Derive a conversation title from its opening question.
 *
 * Titling with the first question rather than asking the model for one keeps
 * a new conversation from costing an extra completion, and the question is
 * usually what the person would have called it anyway.
 */
export function titleFromQuestion(question: string): string {
  const collapsed = question.replaceAll(/\s+/g, " ").trim();
  return collapsed.length <= EXPLORE_TITLE_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, EXPLORE_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
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
  prisma: ExploreTurnStoreClient,
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
  return row === null
    ? null
    : buildTranscript(row, row.messages, leafIdOverride ?? row.currentLeafId);
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
  return row === null
    ? null
    : buildTranscript(row, row.messages, row.sharedLeafId);
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
  prisma: ExploreTurnStoreClient,
  input: {
    conversationId: string | null;
    newId?: string;
    userId: DiscordAccountId;
    question: string;
    attach: ExploreAttachPoint;
    /** Server-owned surface that creates a new conversation. */
    origin?: "legacy" | "web" | "discord" | "voice";
  },
): Promise<{
  conversationId: string;
  title: string;
  messageId: string;
  expectedCurrentLeafId: string | null;
  previousCurrentLeafId: string | null;
  createdConversation: boolean;
  createdQuestion: boolean;
}> {
  if (input.conversationId === null) {
    const created = await prisma.exploreConversation.create({
      data: {
        ...(input.newId === undefined ? {} : { id: input.newId }),
        userId: input.userId,
        title: titleFromQuestion(input.question),
        origin: input.origin ?? "legacy",
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
      previousCurrentLeafId: null,
      createdConversation: true,
      createdQuestion: true,
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
  // (`ExploreMessage_parentId_fkey`), so the row is refused rather than
  // written. What the check buys is the right error. An
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
    previousCurrentLeafId: existing.currentLeafId,
    createdConversation: false,
    createdQuestion: true,
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
  prisma: ExploreTurnStoreClient,
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
  previousCurrentLeafId: string | null;
  createdConversation: boolean;
  createdQuestion: boolean;
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
    previousCurrentLeafId: existing.currentLeafId,
    createdConversation: false,
    createdQuestion: false,
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
    matchCards?: ExploreMatchCard[] | undefined;
    /**
     * The guilds this turn resolved its capabilities from.
     *
     * Recorded per turn rather than per conversation: a conversation belongs
     * to a person, but the tools a turn had depended on this, and replaying it
     * with the wrong guild silently changes which tools existed.
     */
    guildIds: readonly string[];
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
      spokenContent: input.answer.spokenAnswer ?? null,
      queryText: input.answer.queryText,
      caveats: JSON.stringify(input.answer.caveats),
      followUps: JSON.stringify(input.answer.followUps),
      // Running a query is not enough to persist a chart or table. The agent
      // must opt in via includeVisualization; ScoutQL stays on queryText.
      preview:
        input.answer.includeVisualization && input.preview !== null
          ? JSON.stringify(input.preview)
          : null,
      visualization:
        input.answer.includeVisualization && input.visualization !== null
          ? JSON.stringify(input.visualization)
          : null,
      guildIds:
        input.guildIds.length === 0 ? null : JSON.stringify(input.guildIds),
      matchCards:
        input.matchCards === undefined || input.matchCards.length === 0
          ? null
          : JSON.stringify(input.matchCards),
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

/** Load speech text without adding it to the public transcript contract. */
export async function loadExploreSpokenContent(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    messageId: string;
    userId: DiscordAccountId;
  },
): Promise<string | null> {
  const row = await prisma.exploreMessage.findFirst({
    where: {
      id: input.messageId,
      conversationId: input.conversationId,
      role: "assistant",
      conversation: { userId: input.userId },
    },
    select: { spokenContent: true },
  });
  return row?.spokenContent ?? null;
}

/**
 * Load the exact answer persisted by one durable Explore run. The run result
 * is authoritative even when another tab changed the conversation's visible
 * branch while that run was working.
 */
export async function loadExploreRunResult(
  prisma: ExtendedPrismaClient,
  input: {
    runId: string;
    conversationId: string;
    userId: DiscordAccountId;
  },
): Promise<{ answer: ExploreMessage; spokenContent: string | null } | null> {
  const run = await prisma.scoutInteractiveRun.findFirst({
    where: {
      id: input.runId,
      kind: "explore",
      ownerId: input.userId,
      conversationId: input.conversationId,
    },
    select: { resultMessageId: true },
  });
  if (run?.resultMessageId === null || run?.resultMessageId === undefined) {
    return null;
  }
  const row = await prisma.exploreMessage.findFirst({
    where: {
      id: run.resultMessageId,
      conversationId: input.conversationId,
      role: "assistant",
      conversation: { userId: input.userId },
    },
  });
  if (row === null) return null;
  const siblings = await prisma.exploreMessage.findMany({
    where: { conversationId: input.conversationId },
    select: { id: true, parentId: true, createdAt: true },
  });
  return {
    answer: toMessage(row, versionsOf(siblings, row.id)),
    spokenContent: row.spokenContent,
  };
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
    return updated.count === 0 ? null : shareToken;
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
