import type { DiscordAccountId, ExploreMessage } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

type RollbackInput = {
  conversationId: string;
  messageId: ExploreMessage["id"];
  userId: DiscordAccountId;
  previousCurrentLeafId: string | null;
  createdConversation: boolean;
  createdQuestion: boolean;
};

type RollbackClient = Pick<
  ExtendedPrismaClient,
  "exploreConversation" | "exploreMessage" | "exploreAttachment"
>;

export async function rollbackUnstartedExploreTurnInTransaction(
  prisma: RollbackClient,
  input: RollbackInput,
): Promise<void> {
  if (!input.createdQuestion) return;
  // The question's images go back to being unsent uploads before the
  // question is deleted: the asker can send them again, and the unsent sweep
  // still finds them if they do not. A cascade would drop the rows and leave
  // their objects untracked.
  await prisma.exploreAttachment.updateMany({
    where: { questionId: input.messageId },
    data: { questionId: null, position: null },
  });
  if (input.createdConversation) {
    await prisma.exploreConversation.deleteMany({
      where: { id: input.conversationId, userId: input.userId },
    });
    return;
  }
  await prisma.exploreConversation.updateMany({
    where: {
      id: input.conversationId,
      userId: input.userId,
      currentLeafId: input.messageId,
    },
    data: { currentLeafId: input.previousCurrentLeafId },
  });
  await prisma.exploreMessage.deleteMany({
    where: {
      id: input.messageId,
      conversationId: input.conversationId,
      role: "user",
    },
  });
}

export async function rollbackUnstartedExploreTurn(
  prisma: ExtendedPrismaClient,
  input: RollbackInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await rollbackUnstartedExploreTurnInTransaction(tx, input);
  });
}
