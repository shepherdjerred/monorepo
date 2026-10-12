import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from "discord.js";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import { sportsListingEvents } from "@shepherdjerred/streambot/sports/listing-text.ts";
import type { SportsEvent } from "@shepherdjerred/streambot/sports/types.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { sendSportsMenu } from "@shepherdjerred/streambot/discord/sports-menu.ts";
import {
  playbackChannelLabel,
  NUMBERED_CHANNEL_HINT,
  PlaybackChannelNumberSchema,
} from "@shepherdjerred/streambot/types/playback-channel.ts";

type SportsCommandDeps = Pick<
  PlaybackCommandServiceDeps,
  | "config"
  | "library"
  | "resolvePlaySource"
  | "sports"
  | "featureGate"
  | "history"
> & {
  readonly getSessions: () => Pick<
    SessionManager,
    "ensureForPlay" | "releaseUnused"
  > &
    Partial<Pick<SessionManager, "selectedChannel" | "numbered">>;
};

/** Resolve the current voice channel at selection time, rather than reserving a bot while browsing. */
export async function playSportsSelection(
  interaction: MessageComponentInteraction,
  event: SportsEvent,
  deps: SportsCommandDeps,
): Promise<string> {
  if (event.status === "scheduled") {
    throw new PlaybackCommandBoundaryError(
      "That game is not live yet. Choose a live or unconfirmed game.",
    );
  }
  const guildId = GuildIdSchema.parse(interaction.guildId);
  const userId = UserIdSchema.parse(interaction.user.id);
  const voiceId = interaction.guild?.voiceStates.cache.get(
    interaction.user.id,
  )?.channelId;
  if (voiceId === null || voiceId === undefined) {
    throw new PlaybackCommandBoundaryError(
      "Join a voice channel, then choose a game from a fresh sports listing.",
    );
  }
  const voiceChannelId = ChannelIdSchema.parse(voiceId);
  const statusChannelId = ChannelIdSchema.parse(interaction.channelId);
  const sessions = deps.getSessions();
  const scope = { guildId, channelId: voiceChannelId, userId };
  const numbered = sessions.numbered;
  if (numbered !== undefined && (await numbered.automatic(scope))) {
    const commandDeps = await numbered.commandDeps(scope, statusChannelId);
    const result = await new PlaybackCommandService(commandDeps).play({
      query: event.title,
      source: "auto",
      placement: "queue",
      userId,
      sourceOverride: { kind: "url", url: event.pageUrl, sportsEvent: event },
      spoken: false,
    });
    return `${playbackChannelLabel(PlaybackChannelNumberSchema.parse(2))}\n${result.message}`;
  }
  const playbackChannel = await sessions.selectedChannel?.({
    guildId,
    channelId: voiceChannelId,
    userId,
  });
  if (playbackChannel === 1)
    throw new PlaybackCommandBoundaryError(
      `Sports need a video channel. ${NUMBERED_CHANNEL_HINT}`,
    );
  const handle = sessions.ensureForPlay({
    guildId,
    voiceChannelId,
    statusChannelId,
    ...(playbackChannel === undefined ? {} : { playbackChannel }),
  });
  if (handle === null) {
    throw new PlaybackCommandBoundaryError(
      "No stream bots are available right now — try again later.",
    );
  }
  try {
    const playback = new PlaybackCommandService({
      ...(playbackChannel === undefined ? {} : { playbackChannel }),
      ...deps,
      dispatch: handle.dispatch,
      view: handle.view,
      setVolume: handle.setVolume,
      seek: handle.seek,
      guildId,
      channelId: voiceChannelId,
      announce: async (content) => {
        if (interaction.channel?.isSendable() !== true)
          throw new Error("Sports playback status channel is not sendable");
        await interaction.channel.send({ content });
      },
    });
    const result = await playback.play({
      query: event.title,
      source: "auto",
      placement: "queue",
      userId,
      sourceOverride: {
        kind: "url",
        url: event.pageUrl,
        mode: "video",
        sportsEvent: event,
      },
      spoken: false,
    });
    return playbackChannel === undefined
      ? result.message
      : `${playbackChannelLabel(playbackChannel)}\n${result.message}`;
  } finally {
    if (playbackChannel === undefined)
      sessions.releaseUnused(guildId, voiceChannelId);
    else sessions.releaseUnused(guildId, voiceChannelId, playbackChannel);
  }
}

export async function runSportsCommand(
  interaction: ChatInputCommandInteraction,
  deps: SportsCommandDeps,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const guildId = GuildIdSchema.parse(interaction.guildId);
    const userId = UserIdSchema.parse(interaction.user.id);
    const events = await sportsListingEvents({
      scope: {
        guildId,
        userId,
        channelId: ChannelIdSchema.parse(
          interaction.guild?.voiceStates.cache.get(interaction.user.id)
            ?.channelId ?? interaction.channelId,
        ),
      },
      catalog: deps.sports,
      enabled: deps.featureGate?.sportsStreaming,
      signal: AbortSignal.timeout(15_000),
    });
    await sendSportsMenu(interaction, events, async (picked, event) => {
      try {
        return await playSportsSelection(picked, event, deps);
      } catch (error) {
        if (error instanceof PlaybackCommandBoundaryError) return error.message;
        throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof PlaybackCommandBoundaryError)) throw error;
    await interaction.editReply({
      content: error.message,
      embeds: [],
      components: [],
    });
  }
}
