import type { DiscordAccountId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export async function rollbackUnstartedExploreTurn(
  prisma: ExtendedPrismaClient,
  input: {
    conversationId: string;
    messageId: string;
    userId: DiscordAccountId;
    previousCurrentLeafId: string | null;
    createdConversation: boolean;
    createdQuestion: boolean;
  },
): Promise<void> {
  if (!input.createdQuestion) return;
  if (input.createdConversation) {
    await prisma.exploreConversation.deleteMany({
      where: { id: input.conversationId, userId: input.userId },
    });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.exploreConversation.updateMany({
      where: {
        id: input.conversationId,
        userId: input.userId,
        currentLeafId: input.messageId,
      },
      data: { currentLeafId: input.previousCurrentLeafId },
    });
    await tx.exploreMessage.deleteMany({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        role: "user",
      },
    });
  });
}
