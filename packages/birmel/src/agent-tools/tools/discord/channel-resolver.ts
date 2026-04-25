import type {
  Client,
  Channel,
  SendableChannels,
  TextBasedChannel,
} from "discord.js";

/**
 * Resolution result for a Discord channel lookup.
 *
 * `kind === "ok"` carries the narrowed channel; the other kinds carry a
 * descriptive reason so the calling tool can return a useful error to the
 * model without inventing prose for each call site.
 */
export type ChannelResolution<T extends Channel> =
  | { kind: "ok"; channel: T }
  | { kind: "not-found" }
  | { kind: "wrong-type"; actualType: string };

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: "GuildText",
  1: "DM",
  2: "GuildVoice",
  3: "GroupDM",
  4: "GuildCategory",
  5: "GuildAnnouncement",
  10: "AnnouncementThread",
  11: "PublicThread",
  12: "PrivateThread",
  13: "GuildStageVoice",
  14: "GuildDirectory",
  15: "GuildForum",
  16: "GuildMedia",
};

function describeChannelType(channel: Channel): string {
  // discord.js ChannelType is numeric — translate to a label so logs and
  // user-facing errors are readable. Falling back to the numeric value keeps
  // output useful even if discord.js adds a new variant before we update.
  const typeName = CHANNEL_TYPE_NAMES[channel.type];
  return typeName ?? `Type${String(channel.type)}`;
}

/**
 * Narrow a fetched channel to a sendable text-capable channel.
 *
 * Pure type-narrowing — no I/O. Exposed separately from
 * {@link resolveSendableChannel} so tests can exercise the channel-type
 * matrix without standing up a real discord.js Client.
 *
 * `SendableChannels` covers every channel where `.send(content)` is valid:
 * GuildText, GuildAnnouncement, public/private/announcement threads, voice
 * and stage voice text, DMs, and GroupDMs. Forum and media parent channels
 * are intentionally excluded — you `.send` to a thread inside them.
 */
export function narrowToSendable(
  channel: Channel | null,
): ChannelResolution<SendableChannels> {
  if (channel == null) {
    return { kind: "not-found" };
  }
  if (channel.isSendable()) {
    return { kind: "ok", channel };
  }
  return { kind: "wrong-type", actualType: describeChannelType(channel) };
}

/**
 * Narrow a fetched channel to a text-based channel (has a `messages`
 * collection — covers everything `narrowToSendable` does plus forum and
 * media channels which can `messages.fetch` even though they can't directly
 * `send`).
 */
export function narrowToTextBased(
  channel: Channel | null,
): ChannelResolution<TextBasedChannel> {
  if (channel == null) {
    return { kind: "not-found" };
  }
  if (channel.isTextBased()) {
    return { kind: "ok", channel };
  }
  return { kind: "wrong-type", actualType: describeChannelType(channel) };
}

/**
 * Fetch a channel by ID and confirm it is a sendable text-capable channel.
 *
 * Replaces the old `fetchTextChannel` helper that only accepted GuildText
 * and silently dropped requests against threads, announcement channels, and
 * DMs.
 */
export async function resolveSendableChannel(
  client: Client,
  channelId: string,
): Promise<ChannelResolution<SendableChannels>> {
  return narrowToSendable(await client.channels.fetch(channelId));
}

/**
 * Fetch a channel by ID and confirm it is text-based.
 */
export async function resolveTextBasedChannel(
  client: Client,
  channelId: string,
): Promise<ChannelResolution<TextBasedChannel>> {
  return narrowToTextBased(await client.channels.fetch(channelId));
}

/**
 * Build a user-facing error message describing why a channel resolution
 * failed.
 */
export function describeChannelResolutionFailure(
  result: Exclude<ChannelResolution<Channel>, { kind: "ok" }>,
  channelId: string,
): string {
  switch (result.kind) {
    case "not-found":
      return `Channel ${channelId} not found (deleted or no access)`;
    case "wrong-type":
      return `Channel ${channelId} is a ${result.actualType}, which does not support this operation`;
  }
}
