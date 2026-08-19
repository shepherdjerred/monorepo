import { client } from "#src/discord/client.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-message-controls");

/** Grey out controls on closed parlay messages without fetching history. */
export async function disableClosedBettingMessages(
  closed: readonly {
    matchId: string;
    serverId: string;
    messageRefs: readonly { channelId: string; messageId: string }[];
  }[],
): Promise<void> {
  for (const pool of closed) {
    for (const ref of pool.messageRefs) {
      try {
        const channel = await client.channels.fetch(ref.channelId);
        if (channel?.isTextBased() !== true) {
          continue;
        }
        await channel.messages.edit(ref.messageId, { components: [] });
      } catch (error) {
        logger.warn(
          `⚠️ Could not disable Bryan Bucks buttons on ${ref.messageId}:`,
          error,
        );
      }
    }
  }
}
