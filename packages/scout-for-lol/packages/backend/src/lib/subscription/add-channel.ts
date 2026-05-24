import { z } from "zod";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/lib/audit/index.ts";
import type {
  AddSubscriptionChannelInput,
  AddSubscriptionChannelResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-add-channel");

const PrismaKnownErrorSchema = z.object({ code: z.string() });

function isUniqueConstraintError(error: unknown): boolean {
  const parsed = PrismaKnownErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "P2002";
}

export async function addSubscriptionChannel(
  input: AddSubscriptionChannelInput,
  db: Db,
): Promise<AddSubscriptionChannelResult> {
  const { guildId, alias, channelId, actorDiscordId } = input;

  try {
    const player = await db.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias } },
      include: { subscriptions: true },
    });

    if (!player) {
      return { kind: "player-not-found" };
    }

    const existing = player.subscriptions.find(
      (s) => s.channelId === channelId,
    );
    if (existing) {
      return { kind: "already-subscribed", channelId };
    }

    const now = new Date();
    await db.subscription.create({
      data: {
        playerId: player.id,
        channelId,
        serverId: guildId,
        creatorDiscordId: actorDiscordId,
        createdTime: now,
        updatedTime: now,
      },
    });

    logger.info(`✅ Added subscription for "${alias}" to channel ${channelId}`);

    return {
      kind: "added",
      allChannelIds: [
        ...player.subscriptions.map((s) => s.channelId),
        channelId,
      ],
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { kind: "already-subscribed", channelId };
    }
    logger.error("❌ Error adding subscription channel:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
