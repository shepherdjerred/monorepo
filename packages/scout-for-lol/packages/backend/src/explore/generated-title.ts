import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { ExploreNotFoundError, titleFromQuestion } from "#src/explore/store.ts";

export type GeneratedTitleRollback = {
  generatedTitle: string;
  placeholderTitle: string;
};

/**
 * Replace the question-derived placeholder with the first generated title.
 *
 * Deriving the placeholder here makes the conditional update self-limiting to
 * the first turn and prevents a late generated title from clobbering a rename.
 */
export async function applyGeneratedTitle(
  prisma: ExtendedPrismaClient,
  input: { conversationId: string; title: string },
): Promise<{ title: string; rollback: GeneratedTitleRollback | null }> {
  const conversation = await prisma.exploreConversation.findUnique({
    where: { id: input.conversationId },
    include: {
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
    return { title: conversation.title, rollback: null };
  }
  const result = await prisma.exploreConversation.updateMany({
    where: { id: input.conversationId, title: placeholder },
    data: { title },
  });
  return result.count > 0
    ? {
        title,
        rollback: {
          generatedTitle: title,
          placeholderTitle: placeholder,
        },
      }
    : { title: conversation.title, rollback: null };
}

/** Undo a generated title only while it still owns the row. */
export async function rollbackGeneratedTitle(
  prisma: ExtendedPrismaClient,
  input: GeneratedTitleRollback & { conversationId: string },
): Promise<void> {
  await prisma.exploreConversation.updateMany({
    where: { id: input.conversationId, title: input.generatedTitle },
    data: { title: input.placeholderTitle },
  });
}
