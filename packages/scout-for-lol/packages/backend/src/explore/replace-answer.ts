import type {
  ExploreAnswer,
  ExploreMessage,
  ExploreTraceEntry,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  ExploreNotFoundError,
  toMessage,
  versionsOf,
} from "#src/explore/store.ts";

/** Replace a just-created answer when cancellation wins during persistence. */
export async function replaceExploreAnswer(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    messageId: string;
    answer: ExploreAnswer;
    trace: ExploreTraceEntry[];
  },
): Promise<ExploreMessage> {
  const updated = await prisma.exploreMessage.updateMany({
    where: { id: input.messageId, conversationId: input.conversationId },
    data: {
      content: input.answer.answer,
      queryText: input.answer.queryText,
      caveats: JSON.stringify(input.answer.caveats),
      followUps: JSON.stringify(input.answer.followUps),
      preview: null,
      visualization: null,
      trace: JSON.stringify(input.trace),
    },
  });
  if (updated.count !== 1) {
    throw new ExploreNotFoundError("Explore answer not found.");
  }
  const row = await prisma.exploreMessage.findFirstOrThrow({
    where: { id: input.messageId, conversationId: input.conversationId },
  });
  const siblings = await prisma.exploreMessage.findMany({
    where: { conversationId: input.conversationId },
    select: { id: true, parentId: true, createdAt: true },
  });
  return toMessage(row, versionsOf(siblings, row.id));
}

/** Remove a just-created answer when cancellation wins before any prose. */
export async function discardExploreAnswer(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    messageId: string;
    expectedCurrentLeafId: string | null;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.exploreConversation.updateMany({
      where: { id: input.conversationId, currentLeafId: input.messageId },
      data: { currentLeafId: input.expectedCurrentLeafId },
    });
    const deleted = await tx.exploreMessage.deleteMany({
      where: { id: input.messageId, conversationId: input.conversationId },
    });
    if (deleted.count !== 1) {
      throw new ExploreNotFoundError("Explore answer not found.");
    }
  });
}
