import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { CommandBotDeps } from "./command-bot-deps.ts";
import type { CommandHandler } from "./command-handler.ts";
import {
  labelPlaybackInteraction,
  resolveCommandTarget,
  routeNumberedCommand,
} from "./numbered-command-routing.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { PlaybackChannelNumber } from "@shepherdjerred/streambot/types/playback-channel.ts";

/** Subcommands that start (or join) a session in the issuer's current voice channel. */
const PLAY_SUBCOMMANDS = new Set([
  "play",
  "playnext",
  "join",
  "replay",
  "previous",
  "load-queue",
  "usual",
  "continue",
]);
const HISTORY_START_SUBCOMMANDS = new Set([
  "replay",
  "previous",
  "load-queue",
  "usual",
  "continue",
]);
/** Subcommands answerable without a playback session (library/yt-dlp lookups + static help). */
const STATELESS_SUBCOMMANDS = new Set([
  "list",
  "search",
  "sources",
  "help",
  "web",
  "favorites",
  "favorite-remove",
  "saved-queues",
  "delete-queue",
]);

export type BuildStreamHandler = (
  handle: SessionHandle,
  announceChannel: ChannelId | null,
  options?: {
    guildId?: string;
    channelId?: string | null;
    routed?: PlaybackCommandServiceDeps;
  },
) => CommandHandler;

async function denyDisabledSessionStart(input: {
  readonly deps: CommandBotDeps;
  readonly subcommand: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly interaction: ChatInputCommandInteraction;
}): Promise<boolean> {
  const gate = input.deps.featureGate;
  if (gate === undefined) {
    return false;
  }
  const scope = {
    guildId: input.guildId,
    channelId: input.channelId,
    userId: input.interaction.user.id,
  };
  const assistantDisabled =
    input.subcommand === "join" && !(await gate.assistantV2(scope));
  const historyDisabled =
    HISTORY_START_SUBCOMMANDS.has(input.subcommand) &&
    !(await gate.history(scope));
  if (!assistantDisabled && !historyDisabled) return false;
  await input.interaction.reply({
    content: assistantDisabled
      ? "The Streambot assistant beta is not enabled here."
      : "Playback history is not available.",
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function runStreamCommand(input: {
  readonly buildHandler: BuildStreamHandler;
  readonly handle: SessionHandle;
  readonly announceChannel: ChannelId | null;
  readonly guildId: GuildId;
  readonly channelId: ChannelId | null;
  readonly interaction: ChatInputCommandInteraction;
  readonly subcommand: string;
  readonly automatic: boolean;
  readonly sessions: SessionManager;
  readonly voiceChannelId: ChannelId | null;
  readonly playbackChannel?: PlaybackChannelNumber;
}): Promise<void> {
  try {
    const scope =
      input.channelId === null
        ? null
        : {
            guildId: input.guildId,
            channelId: input.channelId,
            userId: input.interaction.user.id,
          };
    const routed =
      scope !== null && input.automatic
        ? await input.sessions.numbered.commandDeps(
            scope,
            input.announceChannel,
          )
        : undefined;
    if (input.automatic && routed?.routePlayback === undefined)
      throw new PlaybackCommandBoundaryError(
        "Your channel selection changed. Try again.",
      );
    await input
      .buildHandler(input.handle, input.announceChannel, {
        guildId: input.guildId,
        channelId: input.channelId,
        ...(routed === undefined ? {} : { routed }),
      })
      .run(
        labelPlaybackInteraction(
          input.interaction,
          routed === undefined ? input.playbackChannel : undefined,
          PLAY_SUBCOMMANDS.has(input.subcommand),
        ),
      );
  } finally {
    if (
      input.voiceChannelId !== null &&
      PLAY_SUBCOMMANDS.has(input.subcommand)
    ) {
      input.sessions.releaseUnused(
        input.guildId,
        input.voiceChannelId,
        input.playbackChannel,
      );
    }
  }
}

export async function routeStreamCommand(input: {
  readonly interaction: ChatInputCommandInteraction;
  readonly deps: CommandBotDeps;
  readonly issuerVoiceChannel: () => ChannelId | null;
  readonly buildHandler: BuildStreamHandler;
}): Promise<void> {
  const { interaction, deps } = input;
  const guildId = GuildIdSchema.safeParse(interaction.guildId ?? "");
  if (!guildId.success) {
    await interaction.reply({
      content: "Use this command in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const invoked = ChannelIdSchema.safeParse(interaction.channelId);
  const invokedChannel: ChannelId | null = invoked.success
    ? invoked.data
    : null;
  const sessions = deps.getSessions();
  const voiceChannelId = input.issuerVoiceChannel();
  const numbered = await routeNumberedCommand({
    interaction,
    sessions,
    guildId: guildId.data,
    voiceChannelId,
    adminIds: deps.config.discord.adminIds,
  });
  if (numbered.handled) return;
  const { playbackChannel } = numbered;

  const target = await resolveCommandTarget({
    sessions,
    interaction,
    guildId: guildId.data,
    voiceChannelId,
    invokedChannel,
    playbackChannel,
    startingPlayback: PLAY_SUBCOMMANDS.has(sub),
    stateless: STATELESS_SUBCOMMANDS.has(sub),
    denyStart: () =>
      denyDisabledSessionStart({
        deps,
        subcommand: sub,
        guildId: guildId.data,
        channelId: voiceChannelId ?? invokedChannel ?? "",
        interaction,
      }),
  });
  if (target === null) return;
  const { handle, announceChannel } = target;

  await runStreamCommand({
    buildHandler: input.buildHandler,
    handle,
    announceChannel,
    guildId: guildId.data,
    channelId: voiceChannelId ?? invokedChannel,
    interaction,
    subcommand: sub,
    automatic: target.automatic,
    sessions,
    voiceChannelId,
    ...(playbackChannel === undefined ? {} : { playbackChannel }),
  });
}
