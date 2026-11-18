import type {
  PersistedStation,
  StationKind,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import {
  formatStationDisplayName,
  formatStationStartMessage,
} from "@shepherdjerred/streambot/station/station-session-ops.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  AUDIO_CHANNEL,
  VIDEO_CHANNEL,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { WebCommand } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { WebError } from "./errors.ts";
import type { WebPlayback } from "./playback.ts";
import type { WebSession } from "./session-store.ts";

function stopWebStation(
  playback: WebPlayback,
  guildId: GuildId,
  channelId: ChannelId,
  options: {
    readonly playbackChannel: PlaybackChannelNumber | undefined;
    readonly auto: boolean;
  },
): { message: string } {
  const stopped =
    playback.deps.sessions.stopStation?.({
      guildId,
      voiceChannelId: channelId,
      ...(options.playbackChannel === undefined
        ? {}
        : { playbackChannel: options.playbackChannel }),
      fallbackInRoom: options.auto || options.playbackChannel === undefined,
    }) ?? null;
  if (stopped === null) {
    throw new WebError(
      409,
      "no_station",
      "No station is active in your voice channel.",
    );
  }
  return { message: `Stopped ${formatStationDisplayName(stopped)}.` };
}

function assertManualStationChannel(
  kind: StationKind,
  targetSlot: PlaybackChannelNumber | undefined,
  auto: boolean,
): void {
  if (auto || targetSlot === undefined) {
    return;
  }
  if (kind === "radio" && targetSlot !== AUDIO_CHANNEL) {
    throw new WebError(
      400,
      "invalid_channel",
      "Radio plays on channel 1 (audio) or in Auto mode.",
    );
  }
  if (kind === "tv" && targetSlot === AUDIO_CHANNEL) {
    throw new WebError(
      400,
      "invalid_channel",
      "TV mode requires a video channel (2+) or Auto mode.",
    );
  }
}

function resolveStationTargetSlot(
  playback: WebPlayback,
  input: Extract<WebCommand, { action: "station" }>,
  target: {
    readonly guildId: GuildId;
    readonly channelId: ChannelId;
    readonly playbackChannel: PlaybackChannelNumber | undefined;
    readonly auto: boolean;
  },
  kind: StationKind,
): PlaybackChannelNumber | undefined {
  const defaultSlot = kind === "tv" ? VIDEO_CHANNEL : AUDIO_CHANNEL;
  const targetSlot = target.auto ? defaultSlot : target.playbackChannel;
  assertManualStationChannel(kind, targetSlot, target.auto);
  if (
    target.auto &&
    target.playbackChannel !== defaultSlot &&
    Object.keys(input.slotRevisions).length > 0
  ) {
    const slotRevision = input.slotRevisions[String(defaultSlot)];
    if (
      slotRevision === undefined ||
      playback.deps.sessions.revision(
        target.guildId,
        target.channelId,
        defaultSlot,
      ) !== slotRevision
    ) {
      throw new WebError(
        409,
        "playback_changed",
        kind === "tv"
          ? "Refresh playback before starting TV mode."
          : "Refresh playback before starting Radio.",
      );
    }
  }
  return targetSlot;
}

async function assertWebStationEnabled(
  playback: WebPlayback,
  kind: StationKind,
  scope: { guildId: string; channelId: string; userId: string },
): Promise<void> {
  const gate =
    kind === "tv"
      ? playback.deps.featureGate.tv
      : playback.deps.featureGate.radio;
  if ((await gate?.(scope)) !== true) {
    throw new WebError(
      403,
      "feature_disabled",
      kind === "tv"
        ? "TV mode is not enabled in this server yet."
        : "Radio mode is not enabled in this server yet.",
    );
  }
}

function emptyWebStationMessage(kind: StationKind): string {
  return kind === "tv"
    ? "Could not find any TV episodes, movies, or videos matching that request right now."
    : "Could not find any radio tracks matching that request right now.";
}

export async function executeWebStationCommand(
  playback: WebPlayback,
  session: WebSession,
  input: Extract<WebCommand, { action: "station" }>,
  signal: AbortSignal,
): Promise<{ message: string }> {
  const target = await playback.resolveTarget(session, input);
  if (input.mode === "off") {
    target.guard();
    return stopWebStation(playback, target.guildId, target.channelId, {
      playbackChannel: target.playbackChannel,
      auto: target.auto,
    });
  }
  const kind: StationKind = input.mode;
  await assertWebStationEnabled(playback, kind, target.scope);
  target.guard();
  const targetSlot = resolveStationTargetSlot(playback, input, target, kind);
  if (playback.deps.sessions.startStation === undefined) {
    throw new WebError(
      503,
      "station_unavailable",
      "Station playback is not available right now.",
    );
  }
  const station: PersistedStation = {
    kind,
    scope: input.scope ?? "room",
    ownerId: target.userId,
    ...(kind === "tv" ? { tvPreset: input.tvPreset ?? "my-mix" } : {}),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    recentIdentities: [],
    skippedIdentities: [],
  };
  const started = await playback.deps.sessions.startStation({
    guildId: target.guildId,
    voiceChannelId: target.channelId,
    statusChannelId: target.channelId,
    ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    station,
    signal,
  });
  if (started === null) {
    throw new WebError(
      409,
      "no_session",
      "No stream bots are available right now.",
    );
  }
  if (started.added.length === 0 && started.handle.view().current === null) {
    playback.deps.sessions.stopStation?.({
      guildId: target.guildId,
      voiceChannelId: target.channelId,
      ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    });
    throw new WebError(404, "not_found", emptyWebStationMessage(kind));
  }
  if (targetSlot !== undefined && target.auto) {
    playback.deps.sessions.numbered.selection.follow(target.scope, targetSlot);
  }
  return {
    message: formatStationStartMessage(station, started.added).replaceAll(
      "**",
      "",
    ),
  };
}
