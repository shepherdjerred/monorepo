import { z } from "zod";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/lib/audit/index.ts";
import type {
  MoveSubscriptionInput,
  MoveSubscriptionResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-move");

// Prisma surfaces unique-constraint violations as { code: "P2002", ... }.
// A move can race against another writer creating the destination
// subscription, so we recognize this and surface the domain-level result.
const PrismaKnownErrorSchema = z.object({ code: z.string() });

function isUniqueConstraintError(error: unknown): boolean {
  const parsed = PrismaKnownErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "P2002";
}

export async function moveSubscription(
  input: MoveSubscriptionInput,
  db: Db,
): Promise<MoveSubscriptionResult> {
  const { guildId, alias, fromChannelId, toChannelId } = input;

  if (fromChannelId === toChannelId) {
    return { kind: "same-channel" };
  }

  try {
    const player = await db.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias } },
      include: { subscriptions: true },
    });

    if (!player) {
      return { kind: "player-not-found" };
    }

    const sourceSubscription = player.subscriptions.find(
      (s) => s.channelId === fromChannelId,
    );
    if (!sourceSubscription) {
      return { kind: "not-subscribed-in-from-channel" };
    }

    const existingTarget = player.subscriptions.find(
      (s) => s.channelId === toChannelId,
    );
    if (existingTarget) {
      return { kind: "already-subscribed-in-to-channel" };
    }

    await db.subscription.update({
      where: { id: sourceSubscription.id },
      data: { channelId: toChannelId },
    });

    logger.info(
      `✅ Moved subscription for "${alias}" from ${fromChannelId} to ${toChannelId}`,
    );
    return { kind: "moved" };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Concurrent writer beat us to the destination channel — surface
      // as a domain-level result, not an internal error.
      return { kind: "already-subscribed-in-to-channel" };
    }
    logger.error("❌ Error moving subscription:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
