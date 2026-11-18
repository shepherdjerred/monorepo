import { MessageFlags } from "discord.js";
import type { CommandBotDeps } from "./command-bot-deps.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import {
  StationScopeSchema,
  TvPresetSchema,
  type PersistedStation,
  type StationKind,
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
  VIDEO_CHANNEL,
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

function findActiveStationHandle(input: {
  readonly sessions: SessionManager;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly preferredSlot: PlaybackChannelNumber | undefined;
  readonly kind: StationKind;
}): {
  readonly handle: SessionHandle;
  readonly station: PersistedStation;
  readonly slot: PlaybackChannelNumber | undefined;
} | null {
  const { sessions, guildId, voiceChannelId, preferredSlot, kind } = input;
  const direct = sessions.getExisting(guildId, voiceChannelId, preferredSlot);
  const directStation = direct?.station?.() ?? null;
  if (direct !== null && directStation?.kind === kind) {
    return { handle: direct, station: directStation, slot: preferredSlot };
  }
  const activeSession = sessions.numbered
    .inRoom(guildId, voiceChannelId)
    .find((candidate) => candidate.station?.kind === kind);
  if (activeSession?.station === undefined) {
    return null;
  }
  const fallback = sessions.getExisting(
    guildId,
    voiceChannelId,
    activeSession.playbackChannel,
  );
  const fallbackStation = fallback?.station?.() ?? null;
  if (fallback === null || fallbackStation?.kind !== kind) {
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
  const presetPart =
    station.kind === "tv" && station.tvPreset !== undefined
      ? ` · preset: \`${station.tvPreset}\``
      : "";
  const seedPart =
    station.seed === undefined ? "" : ` · seed: \`${station.seed}\``;
  return `${header}\nScope: \`${station.scope}\`${presetPart}${seedPart}\n${nowLine} · ${String(view.queue.length)} queued`;
}

function incompatibleChannelReply(
  kind: StationKind,
  automatic: boolean,
  targetSlot: PlaybackChannelNumber | undefined,
): string | null {
  if (automatic || targetSlot === undefined) {
    return null;
  }
  if (kind === "radio" && targetSlot !== AUDIO_CHANNEL) {
    return "Radio plays on Streambot channel 1 (audio) or in Automatic mode. Run `/stream select auto:true` or `/stream select channel:1`.";
  }
  return kind === "tv" && targetSlot === AUDIO_CHANNEL
    ? "TV mode requires a video channel (2+) or Automatic mode. Run `/stream select auto:true` or `/stream select channel:2`."
    : null;
}

function parseDiscordStation(
  kind: StationKind,
  interaction: StationCommandInteraction,
  userId: ReturnType<typeof UserIdSchema.parse>,
): PersistedStation {
  const scope = StationScopeSchema.parse(
    interaction.options.getString("scope") ?? "room",
  );
  const tvPreset =
    kind === "tv"
      ? TvPresetSchema.parse(
          interaction.options.getString("preset") ?? "my-mix",
        )
      : undefined;
  const rawSeed = interaction.options.getString("seed")?.trim();
  return {
    kind,
    scope,
    ownerId: userId,
    ...(tvPreset === undefined ? {} : { tvPreset }),
    ...(rawSeed === undefined || rawSeed === "" ? {} : { seed: rawSeed }),
    recentIdentities: [],
    skippedIdentities: [],
  };
}

function emptyStationMessage(kind: StationKind): string {
  return kind === "tv"
    ? "Could not find any TV episodes, movies, or videos right now."
    : "Could not find any radio tracks right now.";
}

async function handleStationStart(input: {
  readonly kind: StationKind;
  readonly interaction: StationCommandInteraction;
  readonly sessions: SessionManager;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly userId: ReturnType<typeof UserIdSchema.parse>;
  readonly discoveryScope: DiscoveryScope;
}): Promise<void> {
  const {
    kind,
    interaction,
    sessions,
    guildId,
    voiceChannelId,
    discoveryScope,
  } = input;
  const station = parseDiscordStation(kind, interaction, input.userId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const defaultSlot = kind === "tv" ? VIDEO_CHANNEL : AUDIO_CHANNEL;
  const automatic = await sessions.numbered.automatic(discoveryScope);
  const targetSlot = automatic
    ? defaultSlot
    : await sessions.selectedChannel(discoveryScope);
  const channelError = incompatibleChannelReply(kind, automatic, targetSlot);
  if (channelError !== null) {
    await interaction.editReply({ content: channelError });
    return;
  }
  const invoked = ChannelIdSchema.safeParse(interaction.channelId);
  const statusChannelId = invoked.success ? invoked.data : voiceChannelId;

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
      kind,
    });
    await interaction.editReply({ content: emptyStationMessage(kind) });
    return;
  }
  if (automatic) {
    sessions.numbered.selection.follow(discoveryScope, defaultSlot);
  }
  const summary = formatStationStartMessage(station, started.added);
  await interaction.editReply({
    content:
      targetSlot === undefined
        ? summary
        : `${playbackChannelLabel(targetSlot)}\n${summary}`,
  });
}

function stationCommandKind(name: string): StationKind | null {
  if (name === "radio") {
    return "radio";
  }
  return name === "tv" ? "tv" : null;
}

async function handleStationStopOrStatus(input: {
  readonly sub: string;
  readonly kind: StationKind;
  readonly interaction: StationCommandInteraction;
  readonly sessions: SessionManager;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly discoveryScope: DiscoveryScope;
}): Promise<void> {
  const { sub, kind, interaction, sessions, guildId, voiceChannelId } = input;
  const label = kind === "tv" ? "TV mode" : "Radio";
  const defaultSlot = kind === "tv" ? VIDEO_CHANNEL : AUDIO_CHANNEL;
  const automatic = await sessions.numbered.automatic(input.discoveryScope);
  const targetSlot = automatic
    ? defaultSlot
    : await sessions.selectedChannel(input.discoveryScope);

  if (sub === "stop") {
    const stopped = sessions.stopStation({
      guildId,
      voiceChannelId,
      ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
      fallbackInRoom: true,
      kind,
    });
    await interaction.reply({
      content:
        stopped === null
          ? `${label} is not active in your voice channel.`
          : `Stopped ${formatStationDisplayName(stopped)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const active = findActiveStationHandle({
    sessions,
    guildId,
    voiceChannelId,
    preferredSlot: targetSlot,
    kind,
  });
  await interaction.reply({
    content:
      active === null
        ? `${label} is not active in your voice channel.`
        : formatStationStatusReply(active.station, active.handle, active.slot),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleStationCommand(
  interaction: StationCommandInteraction,
  deps: CommandBotDeps,
  issuerVoiceChannel: () => ChannelId | null,
): Promise<boolean> {
  const kind = stationCommandKind(interaction.commandName);
  if (kind === null) {
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
      content: `Join a voice channel first, then run \`/${kind}\`.`,
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
  const gate = kind === "tv" ? deps.featureGate?.tv : deps.featureGate?.radio;
  if (sub !== "stop" && gate !== undefined && !(await gate(discoveryScope))) {
    const modeLabel = kind === "tv" ? "TV mode" : "Radio mode";
    await interaction.reply({
      content: `${modeLabel} is not enabled in this server yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const sessions = deps.getSessions();
  if (sub === "start") {
    await handleStationStart({
      kind,
      interaction,
      sessions,
      guildId: guildId.data,
      voiceChannelId,
      userId,
      discoveryScope,
    });
    return true;
  }

  await handleStationStopOrStatus({
    sub,
    kind,
    interaction,
    sessions,
    guildId: guildId.data,
    voiceChannelId,
    discoveryScope,
  });
  return true;
}
