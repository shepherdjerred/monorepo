import type { Client } from "discord.js";
import type { DiscordGuildId, ExploreMessage } from "@scout-for-lol/data";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { exploreCreationConfirmRow } from "#src/discord/scout/messages.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { createLogger } from "#src/logger.ts";
import { voiceManager } from "#src/voice/voice-manager.ts";

const logger = createLogger("voice-confirmations");

/**
 * Send the Confirm buttons a spoken answer prepared to the speaker's DMs.
 *
 * A voice answer has no chat reply to put a button under, and a spoken "say
 * confirm" would let anyone in the channel accept for them. The DM reaches only
 * the person who asked, and the button runs the same confirm path as the web
 * card and the Discord reply.
 */
export async function deliverVoiceConfirmations(input: {
  readonly client: Client;
  readonly userId: string;
  readonly guildId: DiscordGuildId;
  readonly answer: ExploreMessage;
}): Promise<void> {
  const row = exploreCreationConfirmRow(input.answer);
  if (row === null) return;
  const status = await sendDM({
    client: input.client,
    userId: DiscordAccountIdSchema.parse(input.userId),
    guildId: input.guildId,
    kind: "explore_confirmation",
    message:
      "Scout prepared this from your voice question. Nothing is created until you confirm; the button expires in ten minutes.",
    components: [row],
    suppressMentions: true,
  });
  if (status !== "sent") {
    logger.warn("Voice confirmation DM was not delivered", {
      guildId: input.guildId,
      status,
    });
  }
}

export type DeliverVoiceConfirmations = (input: {
  readonly userId: string;
  readonly answer: ExploreMessage;
}) => Promise<void>;

/** The production delivery, reading the gateway client when it is needed. */
export function voiceConfirmationDelivery(
  guildId: DiscordGuildId,
): DeliverVoiceConfirmations {
  return async ({ userId, answer }) => {
    const client = voiceManager.getClient();
    if (client === null) {
      throw new Error("Discord client is unavailable for Voice Explore");
    }
    await deliverVoiceConfirmations({
      client,
      userId,
      guildId,
      answer,
    });
  };
}

/**
 * Offer a finished spoken answer's confirmations, if it prepared any.
 *
 * The speaker has already heard the answer, so a failed delivery is logged
 * rather than thrown: it must not turn a delivered answer into an error.
 */
export async function offerVoiceConfirmations(input: {
  readonly deliver: DeliverVoiceConfirmations | undefined;
  readonly userId: string;
  readonly answer: ExploreMessage;
  readonly guildId: DiscordGuildId;
}): Promise<void> {
  if (input.deliver === undefined) return;
  try {
    await input.deliver({ userId: input.userId, answer: input.answer });
  } catch (error) {
    logger.warn("voice Explore confirmation delivery failed", {
      guildId: input.guildId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
