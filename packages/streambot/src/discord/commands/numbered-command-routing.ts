import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type {
  ChannelId,
  GuildId,
  UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import {
  playbackChannelLabel,
  NUMBERED_CHANNEL_HINT,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import { adaptCommandInteraction } from "@shepherdjerred/streambot/discord/interaction-adapters.ts";
import { EMPTY_HANDLE } from "@shepherdjerred/streambot/session/session-types.ts";

export async function resolveCommandTarget(input: {
  sessions: SessionManager;
  interaction: ChatInputCommandInteraction;
  guildId: GuildId;
  voiceChannelId: ChannelId | null;
  invokedChannel: ChannelId | null;
  startingPlayback: boolean;
  stateless: boolean;
  playbackChannel: PlaybackChannelNumber | undefined;
  denyStart: () => Promise<boolean>;
}) {
  const {
    sessions,
    interaction,
    guildId,
    voiceChannelId,
    invokedChannel,
    playbackChannel,
  } = input;
  if (input.stateless)
    return { handle: EMPTY_HANDLE, announceChannel: invokedChannel };
  if (voiceChannelId === null) {
    await interaction.reply({
      content: "Join a voice channel first, then run that `/stream` command.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  if (input.startingPlayback && (await input.denyStart())) return null;
  const statusChannelId = invokedChannel ?? voiceChannelId;
  const handle = input.startingPlayback
    ? sessions.ensureForPlay({
        guildId,
        voiceChannelId,
        statusChannelId,
        ...(playbackChannel === undefined ? {} : { playbackChannel }),
      })
    : sessions.getExisting(guildId, voiceChannelId, playbackChannel);
  if (handle !== null) return { handle, announceChannel: statusChannelId };
  const missingPlayback =
    playbackChannel === undefined
      ? "Nothing is playing in your voice channel."
      : `Nothing is playing on ${playbackChannelLabel(playbackChannel)}. Use /stream channels to see the other slots.`;
  await interaction.reply({
    content: input.startingPlayback
      ? "No stream bots are available right now — try again later."
      : missingPlayback,
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

export async function routeNumberedCommand(input: {
  interaction: ChatInputCommandInteraction;
  sessions: SessionManager;
  guildId: GuildId;
  voiceChannelId: ChannelId | null;
  adminIds: readonly UserId[];
}): Promise<{
  handled: boolean;
  playbackChannel: PlaybackChannelNumber | undefined;
}> {
  const { interaction, sessions, guildId, voiceChannelId } = input;
  const sub = interaction.options.getSubcommand();
  const scope = {
    guildId,
    channelId: voiceChannelId ?? interaction.channelId,
    userId: interaction.user.id,
  };
  const playbackChannel =
    voiceChannelId === null ? undefined : await sessions.selectedChannel(scope);
  if (sub === "select" || sub === "channels") {
    let content = "Join a Discord voice channel first.";
    if (voiceChannelId !== null)
      content =
        sub === "select"
          ? await sessions.numbered.select(
              scope,
              interaction.options.getInteger("channel", true),
            )
          : await sessions.numbered.list(
              scope,
              interaction.options.getInteger("page") ?? undefined,
            );
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return { handled: true, playbackChannel };
  }
  if (
    sub === "leave" &&
    playbackChannel !== undefined &&
    voiceChannelId !== null
  ) {
    const allowed = input.adminIds.includes(
      UserIdSchema.parse(interaction.user.id),
    );
    if (allowed) sessions.leaveRoom(guildId, voiceChannelId);
    await interaction.reply({
      content: allowed
        ? "Stopped all Streambot channels and left this voice channel."
        : "Only an admin can leave the entire voice channel and stop every playback slot.",
      flags: MessageFlags.Ephemeral,
    });
    return { handled: true, playbackChannel };
  }
  return { handled: false, playbackChannel };
}

export function labelPlaybackInteraction(
  interaction: ChatInputCommandInteraction,
  number: PlaybackChannelNumber | undefined,
  startingPlayback: boolean,
) {
  const adapted = adaptCommandInteraction(interaction);
  if (number === undefined) return adapted;
  const label = (message: string) =>
    `${playbackChannelLabel(number)}\n${message}${startingPlayback ? `\n\n${NUMBERED_CHANNEL_HINT}` : ""}`;
  return {
    ...adapted,
    reply: (message: string) => adapted.reply(label(message)),
    editReply: (message: string) => adapted.editReply(label(message)),
  };
}
