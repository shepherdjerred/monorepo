import { MessageFlags } from "discord.js";
import type { CommandBotDeps } from "./command-bot-deps.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import {
  StationScopeSchema,
  type PersistedStation,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import {
  formatStationDisplayName,
  formatStationStartMessage,
} from "@shepherdjerred/streambot/station/station-session-ops.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  AUDIO_CHANNEL,
  playbackChannelLabel,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";

export type StationCommandInteraction = {
  readonly commandName: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly user: { readonly id: string };
  readonly options: {
    getSubcommand: () => string;
    getString: (name: string) => string | null;
  };
  deferReply: (options: { flags: MessageFlags.Ephemeral }) => Promise<unknown>;
  editReply: (options: { content: string }) => Promise<unknown>;
  reply: (options: {
    content: string;
    flags: MessageFlags.Ephemeral;
  }) => Promise<unknown>;
};

function findActiveStationHandle(
  sessions: SessionManager,
  guildId: GuildId,
  voiceChannelId: ChannelId,
  preferredSlot: PlaybackChannelNumber | undefined,
): {
  readonly handle: SessionHandle;
  readonly station: PersistedStation;
  readonly slot: PlaybackChannelNumber | undefined;
} | null {
  const direct = sessions.getExisting(guildId, voiceChannelId, preferredSlot);
  const directStation = direct?.station?.() ?? null;
  if (direct !== null && directStation !== null) {
    return { handle: direct, station: directStation, slot: preferredSlot };
  }
  const activeSession = sessions.numbered
    .inRoom(guildId, voiceChannelId)
    .find((candidate) => candidate.station !== undefined);
  if (activeSession?.station === undefined) {
    return null;
  }
  const fallback = sessions.getExisting(
    guildId,
    voiceChannelId,
    activeSession.playbackChannel,
  );
  const fallbackStation = fallback?.station?.() ?? null;
  if (fallback === null || fallbackStation === null) {
    return null;
  }
  return {
    handle: fallback,
    station: fallbackStation,
    slot: activeSession.playbackChannel,
  };
}

function formatStationStatusReply(
  station: PersistedStation,
  handle: SessionHandle,
  slot: PlaybackChannelNumber | undefined,
): string {
  const view = handle.view();
  const header =
    slot === undefined
      ? `**${formatStationDisplayName(station)}**`
      : `${playbackChannelLabel(slot)} · **${formatStationDisplayName(station)}**`;
  const nowLine =
    view.current === null
      ? "Now playing: Loading…"
      : `Now playing: **${view.current.title}**`;
  const seedPart =
    station.seed === undefined ? "" : ` · seed: \`${station.seed}\``;
  return `${header}\nScope: \`${station.scope}\`${seedPart}\n${nowLine} · ${String(view.queue.length)} queued`;
}

async function handleRadioStart(input: {
  readonly interaction: StationCommandInteraction;
  readonly sessions: SessionManager;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly userId: ReturnType<typeof UserIdSchema.parse>;
  readonly discoveryScope: DiscoveryScope;
}): Promise<void> {
  const { interaction, sessions, guildId, voiceChannelId, discoveryScope } =
    input;
  const scope = StationScopeSchema.parse(
    interaction.options.getString("scope") ?? "room",
  );
  const rawSeed = interaction.options.getString("seed")?.trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const automatic = await sessions.numbered.automatic(discoveryScope);
  const targetSlot = automatic
    ? AUDIO_CHANNEL
    : await sessions.selectedChannel(discoveryScope);
  if (!automatic && targetSlot !== undefined && targetSlot !== AUDIO_CHANNEL) {
    await interaction.editReply({
      content:
        "Radio plays on Streambot channel 1 (audio) or in Automatic mode. Run `/stream select auto:true` or `/stream select channel:1`.",
    });
    return;
  }
  const invoked = ChannelIdSchema.safeParse(interaction.channelId);
  const statusChannelId = invoked.success ? invoked.data : voiceChannelId;
  const station: PersistedStation = {
    kind: "radio",
    scope,
    ownerId: input.userId,
    ...(rawSeed === undefined || rawSeed === "" ? {} : { seed: rawSeed }),
    recentIdentities: [],
    skippedIdentities: [],
  };

  const started = await sessions.startStation({
    guildId,
    voiceChannelId,
    statusChannelId,
    ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    station,
  });
  if (started === null) {
    await interaction.editReply({
      content: "No stream bots are available right now — try again later.",
    });
    return;
  }
  if (started.added.length === 0 && started.handle.view().current === null) {
    sessions.stopStation({
      guildId,
      voiceChannelId,
      ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    });
    await interaction.editReply({
      content: "Could not find any radio tracks right now.",
    });
    return;
  }
  if (automatic) {
    sessions.numbered.selection.follow(discoveryScope, AUDIO_CHANNEL);
  }
  const summary = formatStationStartMessage(station, started.added);
  await interaction.editReply({
    content:
      targetSlot === undefined
        ? summary
        : `${playbackChannelLabel(targetSlot)}\n${summary}`,
  });
}

export async function handleStationCommand(
  interaction: StationCommandInteraction,
  deps: CommandBotDeps,
  issuerVoiceChannel: () => ChannelId | null,
): Promise<boolean> {
  if (interaction.commandName !== "radio") {
    return false;
  }
  const guildId = GuildIdSchema.safeParse(interaction.guildId ?? "");
  if (!guildId.success) {
    await interaction.reply({
      content: "Use this command in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const voiceChannelId = issuerVoiceChannel();
  if (voiceChannelId === null) {
    await interaction.reply({
      content: "Join a voice channel first, then run `/radio`.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const userId = UserIdSchema.parse(interaction.user.id);
  const sub = interaction.options.getSubcommand();
  const discoveryScope: DiscoveryScope = {
    guildId: guildId.data,
    channelId: voiceChannelId,
    userId,
  };
  if (
    sub !== "stop" &&
    deps.featureGate?.radio !== undefined &&
    !(await deps.featureGate.radio(discoveryScope))
  ) {
    await interaction.reply({
      content: "Radio mode is not enabled in this server yet.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const sessions = deps.getSessions();
  if (sub === "start") {
    await handleRadioStart({
      interaction,
      sessions,
      guildId: guildId.data,
      voiceChannelId,
      userId,
      discoveryScope,
    });
    return true;
  }

  const automatic = await sessions.numbered.automatic(discoveryScope);
  const targetSlot = automatic
    ? AUDIO_CHANNEL
    : await sessions.selectedChannel(discoveryScope);

  if (sub === "stop") {
    const stopped = sessions.stopStation({
      guildId: guildId.data,
      voiceChannelId,
      ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
      fallbackInRoom: true,
    });
    await interaction.reply({
      content:
        stopped === null
          ? "Radio is not active in your voice channel."
          : `Stopped ${formatStationDisplayName(stopped)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const active = findActiveStationHandle(
    sessions,
    guildId.data,
    voiceChannelId,
    targetSlot,
  );
  await interaction.reply({
    content:
      active === null
        ? "Radio is not active in your voice channel."
        : formatStationStatusReply(active.station, active.handle, active.slot),
    flags: MessageFlags.Ephemeral,
  });
  return true;
}
