import type { PersistedStation } from "@shepherdjerred/streambot/state/station-schema.ts";
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

function resolveRadioTargetSlot(
  playback: WebPlayback,
  input: Extract<WebCommand, { action: "station" }>,
  target: {
    readonly guildId: GuildId;
    readonly channelId: ChannelId;
    readonly playbackChannel: PlaybackChannelNumber | undefined;
    readonly auto: boolean;
  },
): PlaybackChannelNumber | undefined {
  const targetSlot = target.auto ? AUDIO_CHANNEL : target.playbackChannel;
  if (
    targetSlot !== undefined &&
    targetSlot !== AUDIO_CHANNEL &&
    !target.auto
  ) {
    throw new WebError(
      400,
      "invalid_channel",
      "Radio plays on channel 1 (audio) or in Auto mode.",
    );
  }
  if (
    target.auto &&
    target.playbackChannel !== AUDIO_CHANNEL &&
    Object.keys(input.slotRevisions).length > 0
  ) {
    const slotRevision = input.slotRevisions[String(AUDIO_CHANNEL)];
    if (
      slotRevision === undefined ||
      playback.deps.sessions.revision(
        target.guildId,
        target.channelId,
        AUDIO_CHANNEL,
      ) !== slotRevision
    ) {
      throw new WebError(
        409,
        "playback_changed",
        "Refresh playback before starting Radio.",
      );
    }
  }
  return targetSlot;
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
  if (input.mode === "tv") {
    throw new WebError(
      403,
      "feature_disabled",
      "TV mode is not enabled in this server yet.",
    );
  }
  if ((await playback.deps.featureGate.radio?.(target.scope)) !== true) {
    throw new WebError(
      403,
      "feature_disabled",
      "Radio mode is not enabled in this server yet.",
    );
  }
  target.guard();
  const targetSlot = resolveRadioTargetSlot(playback, input, target);
  if (playback.deps.sessions.startStation === undefined) {
    throw new WebError(
      503,
      "station_unavailable",
      "Station playback is not available right now.",
    );
  }
  const station: PersistedStation = {
    kind: "radio",
    scope: input.scope ?? "room",
    ownerId: target.userId,
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
    throw new WebError(
      404,
      "not_found",
      "Could not find any radio tracks matching that request right now.",
    );
  }
  if (targetSlot === AUDIO_CHANNEL && target.auto) {
    playback.deps.sessions.numbered.selection.follow(
      target.scope,
      AUDIO_CHANNEL,
    );
  }
  return {
    message: formatStationStartMessage(station, started.added).replaceAll(
      "**",
      "",
    ),
  };
}
