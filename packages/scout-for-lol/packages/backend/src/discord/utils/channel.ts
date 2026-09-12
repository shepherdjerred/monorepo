import type {
  Channel,
  Client,
  Message,
  MessageCreateOptions,
  MessagePayload,
} from "discord.js";
import { client } from "#src/discord/client.ts";

/**
 * Minimal interface for text channels that support sending messages
 */
export type SendableChannel = {
  send: (
    content: string | MessagePayload | MessageCreateOptions,
  ) => Promise<Message>;
};

/**
 * Check if a channel is text-based and return it with proper typing
 *
 * Discord.js's isTextBased() is a type guard that narrows to TextBasedChannel,
 * which includes the send() method we need.
 *
 * @param channel Channel to check
 * @returns SendableChannel if channel is text-based, undefined otherwise
 */
export function asTextChannel(channel: Channel): SendableChannel | undefined {
  if (!channel.isSendable()) {
    return undefined;
  }

  return channel;
}

/**
 * Resolve a channel by id for a delivery, on a process that may hold no
 * gateway.
 *
 * Every Discord delivery Scout performs — posting a report, editing a Bryan
 * Bucks message, deleting a stale weekly parlay — is a REST call against a
 * channel id. Resolving that id is where the gateway used to sneak back in:
 * `client.channels.fetch(id)` performs the REST lookup either way, but then
 * builds the channel by resolving its guild in `client.guilds.cache`, and with
 * the default `allowUnknownGuild: false` it DROPS the channel entirely when the
 * guild is not there — `fetch` resolves `null`, indistinguishable from a
 * deleted channel. That cache is filled by GUILD_CREATE, so on the `application`
 * and `activity-worker` roles it is permanently empty and every background
 * delivery would classify a perfectly live channel as missing: scheduled
 * reports and the weekly leaderboard would report success having sent nothing,
 * and the owner would be DMed that a channel they still have was deleted.
 *
 * `allowUnknownGuild: true` relaxes the requirement, not the lookup. discord.js
 * still resolves the guild from cache when it is there, so on `combined` and
 * `gateway` this returns exactly the channel it returned before, guild and all.
 * Two things change:
 *
 * - On a gatewayless role the channel comes back with NO `guild`, and the
 *   permission helpers that walk `guild.members` / `guild.roles` (and
 *   `ThreadChannel.parent`) throw on it instead of answering. Sending, editing
 *   and deleting do not care: they are `rest.post`/`patch`/`delete` on the
 *   channel id. `hasResolvedGuild` in `permissions.ts` is how the permission
 *   paths ask, and every caller of this function must go through it before
 *   touching anything guild-shaped.
 * - An unknown-guild channel is never written to `client.channels.cache`, so a
 *   channel the gateway has not already cached costs one REST call per
 *   delivery. Nothing reads that cache for delivery (the gateway's own voice
 *   paths read `guild.channels.cache`, which GUILD_CREATE fills), and a cache
 *   consulted before the request keeps gateway roles on their existing path.
 */
export async function fetchChannelForDelivery(
  channelId: string,
  target: Client = client,
): Promise<Channel | null> {
  return await target.channels.fetch(channelId, { allowUnknownGuild: true });
}
