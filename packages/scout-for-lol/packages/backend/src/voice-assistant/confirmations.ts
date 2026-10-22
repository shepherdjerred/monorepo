import type { Client } from "discord.js";
import type { DiscordGuildId, ExploreMessage } from "@scout-for-lol/data";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import {
  exploreCreationConfirmRows,
  MAX_MESSAGE_ROWS,
} from "#src/discord/scout/messages.ts";
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
}): Promise<VoiceConfirmationDelivery> {
  const rows = exploreCreationConfirmRows(input.answer);
  if (rows.length === 0) return "none";
  for (let start = 0; start < rows.length; start += MAX_MESSAGE_ROWS) {
    const status = await sendDM({
      client: input.client,
      userId: DiscordAccountIdSchema.parse(input.userId),
      guildId: input.guildId,
      kind: "explore_confirmation",
      message:
        "Scout prepared this from your voice question. Nothing is created until you confirm; the button expires in ten minutes.",
      components: rows.slice(start, start + MAX_MESSAGE_ROWS),
      suppressMentions: true,
    });
    if (status !== "sent") {
      logger.warn("Voice confirmation DM was not delivered", {
        guildId: input.guildId,
        status,
      });
      return "not_sent";
    }
  }
  return "sent";
}

/** Whether the speaker got their Confirm buttons. */
export type VoiceConfirmationDelivery =
  | "none"
  | "sent"
  | "not_sent"
  /** Still sending when the answer was ready; it continues in the background. */
  | "pending";

/** How long a ready spoken answer waits on the DM before it is spoken. */
const DM_WAIT_MS = 3000;

export type DeliverVoiceConfirmations = (input: {
  readonly userId: string;
  readonly answer: ExploreMessage;
}) => Promise<VoiceConfirmationDelivery>;

/** The production delivery, reading the gateway client when it is needed. */
export function voiceConfirmationDelivery(
  guildId: DiscordGuildId,
): DeliverVoiceConfirmations {
  return async ({ userId, answer }) => {
    const client = voiceManager.getClient();
    if (client === null) {
      throw new Error("Discord client is unavailable for Voice Explore");
    }
    return await deliverVoiceConfirmations({
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
 * The speaker has already heard the answer, so a failed delivery is not an
 * error: it is reported back so the spoken answer can say the buttons did not
 * arrive and where else to confirm.
 */
export async function offerVoiceConfirmations(input: {
  readonly deliver: DeliverVoiceConfirmations | undefined;
  readonly userId: string;
  readonly answer: ExploreMessage;
  readonly guildId: DiscordGuildId;
}): Promise<VoiceConfirmationDelivery> {
  if (input.deliver === undefined) return "none";
  const { deliver } = input;
  const delivery = (async (): Promise<VoiceConfirmationDelivery> => {
    try {
      return await deliver({ userId: input.userId, answer: input.answer });
    } catch (error) {
      logger.warn("voice Explore confirmation delivery failed", {
        guildId: input.guildId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "not_sent";
    }
  })();
  // The answer is already ready; a stalled Discord request must not hold it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<VoiceConfirmationDelivery>((resolve) => {
    timer = setTimeout(() => {
      resolve("pending");
    }, DM_WAIT_MS);
  });
  try {
    return await Promise.race([delivery, waited]);
  } finally {
    clearTimeout(timer);
  }
}

/** Said after the answer when the Confirm buttons could not be sent. */
export const UNDELIVERED_CONFIRMATION_NOTE =
  "I couldn't send the Confirm button to your Discord messages, so nothing is created yet. Open this conversation in Scout Explore on the web to confirm it.";
