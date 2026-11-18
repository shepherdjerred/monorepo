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
  StationKind,
  StationScope,
  TvPreset,
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

const TV_PRESET_LABELS: Readonly<Record<TvPreset, string>> = {
  "my-mix": "My Mix",
  "continue-series": "Continue Series",
  sitcoms: "Sitcoms",
  movies: "Movies",
  youtube: "YouTube",
};

export async function gateRestoredStation(
  gate: MediaFeatureGate | undefined,
  guildId: GuildId,
  channelId: ChannelId,
  station: PersistedStation | undefined,
): Promise<PersistedStation | undefined> {
  if (station === undefined) {
    return undefined;
  }
  const check = station.kind === "radio" ? gate?.radio : gate?.tv;
  if (check !== undefined) {
    const enabled = await check({
      guildId,
      channelId,
      userId: station.ownerId,
    });
    if (!enabled) {
      return undefined;
    }
  }
  return station;
}

export function formatStationDisplayName(station: PersistedStation): string {
  if (station.kind === "tv") {
    const label = TV_PRESET_LABELS[station.tvPreset ?? "my-mix"];
    return station.seed === undefined
      ? `TV (${label})`
      : `TV (${label} · ${station.seed})`;
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
  readonly kind?: StationKind | undefined;
}): PersistedStation | null {
  const matchesKind = (candidate: Session | undefined) =>
    candidate?.station !== undefined &&
    (input.kind === undefined || candidate.station.kind === input.kind);
  let session = input.sessions.get(
    keyOf(input.guildId, input.voiceChannelId, input.playbackChannel),
  );
  if (input.fallbackInRoom === true && !matchesKind(session)) {
    session = [...input.sessions.values()]
      .filter(
        (candidate) =>
          candidate.guildId === input.guildId &&
          candidate.voiceChannelId === input.voiceChannelId &&
          matchesKind(candidate),
      )
      .toSorted(
        (left, right) =>
          (left.playbackChannel ?? 0) - (right.playbackChannel ?? 0),
      )[0];
  }
  if (session === undefined || !matchesKind(session)) {
    return null;
  }

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

export type VoiceStationControlInput = {
  readonly kind?: StationKind | undefined;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly statusChannelId: ChannelId | null;
  readonly userId: UserId;
  readonly action: "start" | "stop";
  readonly tvPreset?: TvPreset | undefined;
  readonly seed?: string | undefined;
  readonly scope?: StationScope | undefined;
  readonly signal: AbortSignal;
  readonly featureGate?: MediaFeatureGate | undefined;
  readonly resolveTargetSlot: (
    scope: DiscoveryScope,
    action: "start" | "stop",
    kind: StationKind,
  ) => Promise<PlaybackChannelNumber | undefined>;
  readonly onFollowAutoSlot?: (
    scope: DiscoveryScope,
    slot: PlaybackChannelNumber,
  ) => void | Promise<void>;
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
    kind?: StationKind;
  }) => PersistedStation | null;
};

async function executeVoiceStationStop(
  input: VoiceStationControlInput,
  discoveryScope: DiscoveryScope,
  kind: StationKind,
): Promise<string> {
  const targetSlot = await input.resolveTargetSlot(
    discoveryScope,
    "stop",
    kind,
  );
  const stopped = input.stopStation({
    guildId: input.guildId,
    voiceChannelId: input.voiceChannelId,
    ...(targetSlot === undefined ? {} : { playbackChannel: targetSlot }),
    fallbackInRoom: true,
    kind,
  });
  if (stopped === null) {
    throw new PlaybackCommandBoundaryError(
      kind === "tv"
        ? "TV mode is not playing right now."
        : "Radio is not playing right now.",
    );
  }
  return `Stopped ${formatStationDisplayName(stopped)}.`;
}

async function assertVoiceStationAllowed(
  input: VoiceStationControlInput,
  discoveryScope: DiscoveryScope,
  kind: StationKind,
  targetSlot: PlaybackChannelNumber | undefined,
): Promise<void> {
  const gate = kind === "tv" ? input.featureGate?.tv : input.featureGate?.radio;
  if (gate !== undefined && !(await gate(discoveryScope))) {
    throw new PlaybackCommandBoundaryError(
      kind === "tv"
        ? "TV mode is not enabled in this server."
        : "Radio mode is not enabled in this server.",
    );
  }
  if (
    kind === "radio" &&
    targetSlot !== undefined &&
    targetSlot !== AUDIO_CHANNEL
  ) {
    throw new PlaybackCommandBoundaryError(
      "Radio plays on channel 1 or in automatic mode.",
    );
  }
  if (kind === "tv" && targetSlot === AUDIO_CHANNEL) {
    throw new PlaybackCommandBoundaryError(
      "TV mode requires a video channel (2 or higher) or automatic mode.",
    );
  }
}

export async function executeVoiceStationControl(
  input: VoiceStationControlInput,
): Promise<string> {
  const kind: StationKind = input.kind ?? "radio";
  const discoveryScope: DiscoveryScope = {
    guildId: input.guildId,
    channelId: input.voiceChannelId,
    userId: input.userId,
  };
  if (input.action === "stop") {
    return await executeVoiceStationStop(input, discoveryScope, kind);
  }
  const targetSlot = await input.resolveTargetSlot(
    discoveryScope,
    "start",
    kind,
  );
  await assertVoiceStationAllowed(input, discoveryScope, kind, targetSlot);

  const trimmedSeed = input.seed?.trim();
  const station: PersistedStation = {
    kind,
    scope: input.scope ?? "room",
    ownerId: input.userId,
    ...(kind === "tv" ? { tvPreset: input.tvPreset ?? "my-mix" } : {}),
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
      kind,
    });
    throw new PlaybackCommandBoundaryError(
      kind === "tv"
        ? "I could not find any TV episodes, movies, or videos right now."
        : "I could not find any radio tracks right now.",
    );
  }
  if (targetSlot !== undefined) {
    await input.onFollowAutoSlot?.(discoveryScope, targetSlot);
  }
  return formatStationStartMessage(station, started.added).replaceAll("**", "");
}
