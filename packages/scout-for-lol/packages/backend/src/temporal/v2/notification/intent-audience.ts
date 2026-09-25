import type { NotificationRetirementReason } from "@scout-for-lol/domain/notifications/intent.ts";
import type { NotificationTransitionResult } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import type { Db } from "#src/database/index.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  retireNotificationIntent,
  subscriptionRetirementOf,
} from "#src/durable/match/intent-retirement.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import { botRest } from "#src/lib/discord/bot-rest.ts";
import type { DiscordChannel } from "#src/lib/discord/bot-rest-schemas.ts";
import { isScoutInstalledInGuild } from "#src/lib/discord/installed-guilds.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("scout-v2-intent-audience");

/**
 * Whether an intent's audience still exists, asked on the send path before
 * an attempt is minted.
 *
 * `beginNotificationSendV2` asks this for a `pending` or `ready` intent and,
 * when the answer is a reason, retires the intent instead of beginning a send.
 * Asking there rather than inside the delivery Activity is what keeps the
 * retirement honest: before `beginSend` nothing is in flight, so the domain's
 * `retireOrphaned` can move the intent under the same guarded write every
 * other transition uses, and no attempt is spent — or left ambiguous — on an
 * audience that is not there. The delivery Activity still classifies whatever
 * Discord answers the send itself; this only stops a send that cannot be
 * correct from starting.
 *
 * ## What counts as evidence
 *
 * Only a positive answer retires. Discord saying Unknown Channel is
 * `channel-deleted`. Discord saying the channel's guild no longer has Scout
 * installed is `guild-left`. The database saying no subscription in the
 * channel still follows the match is `subscription-deleted`. Discord being
 * unreachable, or refusing the read (Missing Access looks the same whether
 * Scout was removed from the guild or merely lost sight of one channel), is
 * no evidence at all, and the send goes ahead to find out the ordinary way.
 * A guild removal usually reaches this as `subscription-deleted`: the removal
 * cleanup deletes the guild's subscriptions, and the channel read that could
 * have named the guild is refused once Scout is gone.
 *
 * Discord is asked first because its answer is the more specific one: a
 * deleted channel whose subscriptions the hourly cleanup has not reached yet
 * is still a deleted channel.
 */

/** The two Discord questions, injectable so tests never reach Discord. */
export type AudienceDiscordPort = {
  /** `null` is Discord's Unknown Channel; a throw means Scout could not ask. */
  readonly readChannel: (channelId: string) => Promise<DiscordChannel | null>;
  /** Confirmed against Discord; throws rather than guessing `false`. */
  readonly isInstalled: (guildId: string) => Promise<boolean>;
};

export function defaultAudienceDiscordPort(): AudienceDiscordPort {
  return {
    readChannel: async (channelId) => await botRest().channel(channelId),
    isInstalled: async (guildId) => await isScoutInstalledInGuild(guildId),
  };
}

/**
 * Run one Discord read, turning "Scout could not get an answer" into no
 * evidence. Anything that is not an upstream failure is a broken contract and
 * propagates.
 */
async function askDiscord<Answer>(
  question: string,
  read: () => Promise<Answer>,
): Promise<{ answered: true; answer: Answer } | { answered: false }> {
  try {
    return { answered: true, answer: await read() };
  } catch (error) {
    if (!(error instanceof DiscordUpstreamError)) throw error;
    logger.warn(
      `Discord could not answer ${question} (${error.reason}); no evidence the audience is gone`,
      { status: error.status },
    );
    return { answered: false };
  }
}

async function discordRetirementOf(
  channelId: string,
  discord: AudienceDiscordPort,
): Promise<NotificationRetirementReason | undefined> {
  const channel = await askDiscord(
    `channel ${channelId}`,
    async () => await discord.readChannel(channelId),
  );
  if (!channel.answered) return undefined;
  if (channel.answer === null) return "channel-deleted";
  const guildId = channel.answer.guild_id;
  if (guildId === null || guildId === undefined) return undefined;
  const installed = await askDiscord(
    `whether Scout is in guild ${guildId}`,
    async () => await discord.isInstalled(guildId),
  );
  return installed.answered && !installed.answer ? "guild-left" : undefined;
}

/** The reason this intent's audience is gone, or `undefined` if it stands. */
export async function audienceRetirementOfV2(
  db: Db,
  record: MatchNotificationIntentRecord,
  discord: AudienceDiscordPort,
): Promise<NotificationRetirementReason | undefined> {
  const target = record.intent.target;
  // A DM's audience is one account, and no producer of these kinds mints one
  // yet; there is nothing here to ask.
  return target.kind === "channel"
    ? ((await discordRetirementOf(target.channelId, discord)) ??
        (await subscriptionRetirementOf(db, record)))
    : undefined;
}

/**
 * Retire the intent if its audience is gone, before any attempt is minted.
 *
 * `undefined` means the audience stands — or the intent is not one this may
 * touch — and the caller begins the send as it always did. Only `pending` and
 * `ready` are asked about at all: an attempted intent's state belongs to its
 * attempt or to the operator, and the domain would refuse to retire it anyway.
 * A retirement that loses a race (a conflict) also answers `undefined`, so the
 * caller's own `beginSend` produces the answer it would have produced without
 * this step.
 */
export async function retireIfAudienceGoneV2(
  db: Db,
  record: MatchNotificationIntentRecord,
  discord: AudienceDiscordPort = defaultAudienceDiscordPort(),
): Promise<NotificationTransitionResult | undefined> {
  const state = record.intent.state.kind;
  if (state !== "pending" && state !== "ready") return undefined;
  const reason = await audienceRetirementOfV2(db, record, discord);
  if (reason === undefined) return undefined;
  const result = await retireNotificationIntent(db, {
    record,
    reason,
    source: "send",
  });
  return result.outcome === "conflict" ? undefined : result;
}
