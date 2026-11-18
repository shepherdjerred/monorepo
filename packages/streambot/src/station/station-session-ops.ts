import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import { buildSessionHandle } from "@shepherdjerred/streambot/session/session-handle.ts";
import { describeSnapshot } from "@shepherdjerred/streambot/session/status-snapshot.ts";
import {
  keyOf,
  type Session,
  type SessionHandle,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type {
  PersistedStation,
  StationScope,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import type {
  ChannelId,
  GuildId,
  UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  AUDIO_CHANNEL,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { StationFeeder } from "./station-feeder.ts";
import type { CuratedStationItem } from "./station-types.ts";

export async function gateRestoredStation(
  gate: MediaFeatureGate | undefined,
  guildId: GuildId,
  channelId: ChannelId,
  station: PersistedStation | undefined,
): Promise<PersistedStation | undefined> {
  if (station === undefined) return undefined;
  if (station.kind === "radio" && gate?.radio !== undefined) {
    const enabled = await gate.radio({
      guildId,
      channelId,
      userId: station.ownerId,
    });
    if (!enabled) return undefined;
  }
  return station;
}

export function formatStationDisplayName(station: PersistedStation): string {
  if (station.kind === "tv") {
    return station.tvPreset === undefined
      ? "TV mode"
      : `TV (${station.tvPreset})`;
  }
  if (station.seed !== undefined) {
    return `Radio (${station.seed})`;
  }
  switch (station.scope) {
    case "mine":
      return "My Radio";
    case "server":
      return "Server Radio";
    case "room":
      return "Room Radio";
  }
}

export function formatStationStartMessage(
  station: PersistedStation,
  added: readonly CuratedStationItem[],
): string {
  const name = formatStationDisplayName(station);
  const first = added[0];
  if (first === undefined) {
    return `Started ${name}.`;
  }
  const extra =
    added.length > 1 ? ` (+${String(added.length - 1)} up next)` : "";
  return `Started ${name} — **${first.title}**${extra}.`;
}

export async function startSessionStation(input: {
  readonly config: Config;
  readonly sessions: ReadonlyMap<string, Session>;
  readonly feeder: StationFeeder;
  readonly ensureSession: () => SessionHandle | null;
  readonly saveSnapshot: (session: Session) => Promise<void>;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly playbackChannel?: PlaybackChannelNumber | undefined;
  readonly station: PersistedStation;
  readonly signal?: AbortSignal | undefined;
}): Promise<{
  readonly handle: SessionHandle;
  readonly added: readonly CuratedStationItem[];
} | null> {
  const ensured = input.ensureSession();
  if (ensured === null) return null;
  const session = input.sessions.get(
    keyOf(input.guildId, input.voiceChannelId, input.playbackChannel),
  );
  if (session === undefined) return null;

  input.feeder.abort(session);
  session.station = input.station;
  const added = await input.feeder.ensureLookahead(session, input.signal);
  session.card.refresh();
  await input.saveSnapshot(session);
  return {
    handle: buildSessionHandle(input.config, session, input.feeder),
    added,
  };
}

export function stopSessionStation(input: {
  readonly sessions: ReadonlyMap<string, Session>;
  readonly feeder: StationFeeder;
  readonly releaseUnused: (
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
  ) => void;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly playbackChannel?: PlaybackChannelNumber | undefined;
  readonly fallbackInRoom?: boolean | undefined;
}): PersistedStation | null {
  let session = input.sessions.get(
    keyOf(input.guildId, input.voiceChannelId, input.playbackChannel),
  );
  if (input.fallbackInRoom === true && session?.station === undefined) {
    session = [...input.sessions.values()]
      .filter(
        (candidate) =>
          candidate.guildId === input.guildId &&
          candidate.voiceChannelId === input.voiceChannelId &&
          candidate.station !== undefined,
      )
      .toSorted(
        (left, right) =>
          (left.playbackChannel ?? 0) - (right.playbackChannel ?? 0),
      )[0];
  }
  if (session?.station === undefined) return null;

  const stopped = input.feeder.stop(session);
  const snapshot = session.actor.getSnapshot();
  const { stateName } = describeSnapshot(snapshot);
  if (
    snapshot.context.current === null &&
    snapshot.context.queue.length === 0
  ) {
    if (stateName === "waiting" || stateName === "joining") {
      session.actor.send({ type: "STOP" });
    } else if (stateName === "idle") {
      input.releaseUnused(
        session.guildId,
        session.voiceChannelId,
        session.playbackChannel,
      );
    }
  }
  session.card.refresh();
  return stopped;
}

export type VoiceRadioControlInput = {
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly statusChannelId: ChannelId | null;
  readonly userId: UserId;
  readonly action: "start" | "stop";
  readonly seed?: string | undefined;
  readonly scope?: StationScope | undefined;
  readonly signal: AbortSignal;
  readonly featureGate?: MediaFeatureGate | undefined;
  readonly resolveTargetSlot: (
    scope: DiscoveryScope,
    action: "start" | "stop",
  ) => Promise<PlaybackChannelNumber | undefined>;
  readonly onFollowAutoSlot?: (
    scope: DiscoveryScope,
    slot: PlaybackChannelNumber,
  ) => void;
  readonly startStation: (params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    statusChannelId: ChannelId;
    playbackChannel?: PlaybackChannelNumber;
    station: PersistedStation;
    signal?: AbortSignal;
  }) => Promise<{
    readonly handle: SessionHandle;
    readonly added: readonly CuratedStationItem[];
  } | null>;
  readonly stopStation: (params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    playbackChannel?: PlaybackChannelNumber;
    fallbackInRoom?: boolean;
  }) => PersistedStation | null;
};

async function executeVoiceRadioStop(
  input: VoiceRadioControlInput,
  discoveryScope: DiscoveryScope,
): Promise<string> {
  const targetSlot = await input.resolveTargetSlot(discoveryScope, "stop");
  const stopped = input.stopStation({
    guildId: input.guildId,
    voiceChannelId: input.voiceChannelId,
    ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    fallbackInRoom: true,
  });
  if (stopped === null) {
    throw new PlaybackCommandBoundaryError("Radio is not playing right now.");
  }
  return `Stopped ${formatStationDisplayName(stopped)}.`;
}

export async function executeVoiceRadioControl(
  input: VoiceRadioControlInput,
): Promise<string> {
  const discoveryScope: DiscoveryScope = {
    guildId: input.guildId,
    channelId: input.voiceChannelId,
    userId: input.userId,
  };
  if (input.action === "stop") {
    return await executeVoiceRadioStop(input, discoveryScope);
  }
  if (
    input.featureGate?.radio !== undefined &&
    !(await input.featureGate.radio(discoveryScope))
  ) {
    throw new PlaybackCommandBoundaryError(
      "Radio mode is not enabled in this server.",
    );
  }

  const targetSlot = await input.resolveTargetSlot(discoveryScope, "start");
  if (targetSlot !== undefined && targetSlot !== AUDIO_CHANNEL) {
    throw new PlaybackCommandBoundaryError(
      "Radio plays on channel 1 or in automatic mode.",
    );
  }
  const trimmedSeed = input.seed?.trim();
  const station: PersistedStation = {
    kind: "radio",
    scope: input.scope ?? "room",
    ownerId: input.userId,
    ...(trimmedSeed === undefined || trimmedSeed === ""
      ? {}
      : { seed: trimmedSeed }),
    recentIdentities: [],
    skippedIdentities: [],
  };

  const started = await input.startStation({
    guildId: input.guildId,
    voiceChannelId: input.voiceChannelId,
    statusChannelId: input.statusChannelId ?? input.voiceChannelId,
    ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    station,
    signal: input.signal,
  });
  if (started === null) {
    throw new PlaybackCommandBoundaryError(
      "No stream bots are available right now.",
    );
  }
  if (started.added.length === 0 && started.handle.view().current === null) {
    input.stopStation({
      guildId: input.guildId,
      voiceChannelId: input.voiceChannelId,
      ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    });
    throw new PlaybackCommandBoundaryError(
      "I could not find any radio tracks right now.",
    );
  }
  if (targetSlot === AUDIO_CHANNEL) {
    input.onFollowAutoSlot?.(discoveryScope, AUDIO_CHANNEL);
  }
  return formatStationStartMessage(station, started.added).replaceAll("**", "");
}
