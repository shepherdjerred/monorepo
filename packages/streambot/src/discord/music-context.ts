import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";
import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import {
  GuildIdSchema,
  ChannelIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { IDLE_VIEW } from "@shepherdjerred/streambot/session/session-types.ts";

export type MusicInteraction =
  ChatInputCommandInteraction | MessageComponentInteraction;

export async function musicCommandContext(
  interaction: MusicInteraction,
  deps: CommandBotDeps,
): Promise<PlaybackCommandServiceDeps> {
  const guildId = GuildIdSchema.parse(interaction.guildId);
  const userId = UserIdSchema.parse(interaction.user.id);
  const voice = () =>
    interaction.guild?.voiceStates.cache.get(userId)?.channelId;
  const channel = voice();
  if (channel == null)
    throw new PlaybackCommandBoundaryError(
      "Join a voice channel to play music.",
    );
  const channelId = ChannelIdSchema.parse(channel);
  const sessions = deps.getSessions();
  const scope = { guildId, channelId, userId };
  const selected = await sessions.selectedChannel(scope);
  const membershipGuard = () => {
    if (voice() !== channelId)
      throw new PlaybackCommandBoundaryError(
        "Your voice channel changed. Run the command again.",
      );
  };
  if (selected !== undefined) {
    const bound = await sessions.numbered.commandDeps(
      scope,
      ChannelIdSchema.parse(interaction.channelId),
    );
    const guard = () => {
      membershipGuard();
      bound.assertCurrent?.();
    };
    return {
      ...bound,
      assertCurrent: guard,
      dispatch: (event) => {
        guard();
        bound.dispatch(event);
      },
    };
  }
  let handle = sessions.getExisting(guildId, channelId);
  let revision = sessions.revision(guildId, channelId);
  const guard = () => {
    membershipGuard();
    if (sessions.revision(guildId, channelId) !== revision)
      throw new PlaybackCommandBoundaryError(
        "Playback changed while loading. Try again.",
      );
  };
  return {
    ...deps,
    guildId,
    channelId,
    assertCurrent: guard,
    announce: () => Promise.resolve(),
    view: () => handle?.view() ?? IDLE_VIEW,
    dispatch: (event) => {
      guard();
      handle ??= sessions.ensureForPlay({
        guildId,
        voiceChannelId: channelId,
        statusChannelId: ChannelIdSchema.parse(interaction.channelId),
      });
      if (handle === null)
        throw new PlaybackCommandBoundaryError(
          "No streaming accounts are available right now.",
        );
      handle.dispatch(event);
      revision = sessions.revision(guildId, channelId);
    },
    setVolume: (volume) => handle?.setVolume(volume) ?? Promise.resolve(false),
    seek: (position) => handle?.seek(position) ?? Promise.resolve(false),
  };
}
