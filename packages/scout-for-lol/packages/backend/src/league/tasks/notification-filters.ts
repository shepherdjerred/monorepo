import {
  filtersPass,
  DiscordGuildIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
  type QueueType,
} from "@scout-for-lol/data/index.ts";
import { uniqueBy } from "remeda";
import {
  getChannelsSubscribedToPlayers,
  type SubscribedChannel,
} from "#src/database/subscribed-channels.ts";

/**
 * Filter resolved channels down to those that should be notified for a match,
 * applying each subscription's notification filters. A channel is kept iff at
 * least one of its in-match subscriptions is unmuted and passes (the rendered
 * message is match-level, covering every tracked player in the game).
 */
export function channelsPassingQueueFilter(
  channels: SubscribedChannel[],
  queueType: QueueType | undefined,
): SubscribedChannel[] {
  return channels.filter((channel) =>
    channel.subscriptions.some(
      (subscription) =>
        !subscription.isMuted &&
        filtersPass(subscription.filters, { queueType }),
    ),
  );
}

/**
 * Where one finished match's report goes: the channels subscribed to its
 * tracked players that pass their queue filter, and the guilds those channels
 * belong to.
 *
 * One derivation for every consumer: intents are minted for `deliverable`,
 * and the notification lane renders its attested report against `guildIds`,
 * because the per-guild feature flags the generator evaluates (the AI review)
 * must see the same audience the intents name. `subscribed` is the unfiltered
 * set, kept for the log line that explains an empty delivery.
 */
export async function resolvePostmatchDeliveryChannels(args: {
  puuids: LeaguePuuid[];
  queueType: QueueType | undefined;
}): Promise<{
  subscribed: SubscribedChannel[];
  deliverable: SubscribedChannel[];
  guildIds: DiscordGuildId[];
}> {
  const subscribed = await getChannelsSubscribedToPlayers(args.puuids);
  const deliverable = channelsPassingQueueFilter(subscribed, args.queueType);
  const guildIds = uniqueBy(
    deliverable.map((channel) => DiscordGuildIdSchema.parse(channel.serverId)),
    (id) => id,
  );
  return { subscribed, deliverable, guildIds };
}
