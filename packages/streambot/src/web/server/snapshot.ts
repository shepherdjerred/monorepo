import type { WebPlaybackDeps } from "./playback-deps.ts";
import type { WebSession } from "./session-store.ts";
import { playerBody, slots, type SnapshotOwner } from "./room/player-state.ts";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  GuildIdSchema,
  ChannelIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  AUDIO_CHANNEL,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
export async function buildWebSnapshot(
  owner: SnapshotOwner,
  session: WebSession,
  guild: string,
): Promise<WebSnapshot> {
  const deps = owner.deps;
  await owner.authorize(session, guild);
  const guildId = GuildIdSchema.parse(guild);
  const channel = deps.bot.webVoiceChannel(guildId, session.identity.userId);
  const initialPlaybackChannel =
    channel === null
      ? undefined
      : await deps.sessions.numbered.selected({
          guildId,
          channelId: channel.id,
          userId: session.identity.userId,
        });
  const scope = {
    guildId,
    channelId: channel?.id ?? "web",
    userId: session.identity.userId,
  };
  const automaticRoutingEnabled =
    initialPlaybackChannel !== undefined &&
    (await deps.featureGate.automaticChannelRouting?.(scope)) === true;
  const advancedControls =
    channel !== null &&
    (await deps.featureGate.assistantV2({
      guildId,
      channelId: channel.id,
      userId: session.identity.userId,
    }));
  const sportsEnabled = await owner.sportsEnabled(session, guildId);
  const historyEnabled = await owner.historyEnabled(session, guildId);
  const radioEnabled = (await deps.featureGate.radio?.(scope)) === true;
  const tvEnabled = (await deps.featureGate.tv?.(scope)) === true;
  // Capture the view and its revision together after asynchronous gate checks.
  const resolved = resolveSnapshotSelection(deps, {
    guildId,
    channel,
    scope,
    initialPlaybackChannel,
    automaticRoutingEnabled,
  });
  const { playbackChannel } = resolved;
  const handle =
    channel === null
      ? null
      : deps.sessions.getExisting(guildId, channel.id, playbackChannel);
  const player = await playerBody(owner, handle, guildId, session);
  return {
    channel,
    playbackChannel: playbackChannel ?? null,
    selectedPlaybackChannel: resolved.selectedPlaybackChannel,
    selectionVersion: resolved.selectionVersion,
    selectionMode: resolved.selectionMode,
    automaticRoutingEnabled: resolved.automaticRoutingEnabled,
    playbackChannels: resolved.playbackChannels,
    revision:
      channel === null
        ? null
        : deps.sessions.revision(guildId, channel.id, playbackChannel),
    state: player.state,
    current: player.current,
    queue: player.queue,
    positionSeconds: player.positionSeconds,
    paused: player.paused,
    volume: player.volume,
    loop: player.loop,
    advancedControls,
    sportsEnabled,
    historyEnabled,
    radioEnabled,
    tvEnabled,
    station: player.station,
    restrictedLive: player.restrictedLive,
  };
}

function resolveSnapshotSelection(
  deps: WebPlaybackDeps,
  input: {
    guildId: ReturnType<typeof GuildIdSchema.parse>;
    channel: WebSnapshot["channel"];
    scope: { guildId: string; channelId: string; userId: string };
    initialPlaybackChannel: PlaybackChannelNumber | undefined;
    automaticRoutingEnabled: boolean;
  },
) {
  const {
    guildId,
    channel,
    scope,
    initialPlaybackChannel,
    automaticRoutingEnabled,
  } = input;
  if (initialPlaybackChannel === undefined || channel === null) {
    return {
      playbackChannel: undefined,
      selectedPlaybackChannel: null,
      selectionVersion:
        channel === null
          ? null
          : deps.sessions.numbered.selection.version(scope),
      selectionMode: "manual" as const,
      automaticRoutingEnabled: false,
      playbackChannels: [],
    };
  }
  const playbackChannels = slots(
    deps,
    guildId,
    ChannelIdSchema.parse(channel.id),
  );
  const isManual = deps.sessions.numbered.selection.isManual(scope);
  const playbackChannel =
    isManual || !automaticRoutingEnabled
      ? deps.sessions.numbered.selection.get(scope)
      : resolveAutoPlaybackChannel(deps, scope, playbackChannels);
  return {
    playbackChannel,
    selectedPlaybackChannel: isManual ? playbackChannel : null,
    selectionVersion: deps.sessions.numbered.selection.version(scope),
    selectionMode:
      automaticRoutingEnabled && !isManual
        ? ("auto" as const)
        : ("manual" as const),
    automaticRoutingEnabled,
    playbackChannels,
  };
}

function resolveAutoPlaybackChannel(
  deps: WebPlaybackDeps,
  scope: { guildId: string; channelId: string; userId: string },
  playbackChannels: ReturnType<typeof slots>,
): PlaybackChannelNumber {
  const lastTarget = deps.sessions.numbered.selection.lastTarget(scope);
  return lastTarget !== undefined &&
    playbackChannels.some((slot) => slot.number === lastTarget && slot.occupied)
    ? lastTarget
    : (playbackChannels.find((slot) => slot.occupied)?.number ??
        lastTarget ??
        AUDIO_CHANNEL);
}
