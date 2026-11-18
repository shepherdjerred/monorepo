import type { WebPlaybackDeps } from "./playback-deps.ts";
import type { WebSession } from "./session-store.ts";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  GuildIdSchema,
  ChannelIdSchema,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  AUDIO_CHANNEL,
  PlaybackChannelNumberSchema,
  playbackChannelLabel,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import { IDLE_VIEW } from "@shepherdjerred/streambot/session/session-types.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
type SnapshotOwner = {
  deps: WebPlaybackDeps;
  authorize: (session: WebSession, guild: string) => Promise<void>;
  sportsEnabled: (session: WebSession, guild: string) => Promise<boolean>;
  historyEnabled: (session: WebSession, guild: string) => Promise<boolean>;
  requesterName: (
    session: WebSession,
    guild: string,
    user: string,
  ) => Promise<string>;
};
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
  const view = handle?.view() ?? IDLE_VIEW;
  const source = view.current?.source;
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
    state: view.state,
    current:
      view.current === null
        ? null
        : await playerItem(owner, view.current, guildId, session),
    queue: await Promise.all(
      view.queue.map((item) => playerItem(owner, item, guildId, session)),
    ),
    positionSeconds: view.positionSeconds,
    paused: view.paused === true,
    volume: view.volume,
    loop: view.loop,
    advancedControls,
    sportsEnabled,
    historyEnabled,
    radioEnabled,
    tvEnabled,
    station: webStation(handle),
    restrictedLive:
      source?.kind === "url" && sportsEventForSource(source.url) !== null,
  };
}

function webStation(handle: SessionHandle | null): WebSnapshot["station"] {
  const raw = handle?.station?.() ?? null;
  if (raw === null) return null;
  return {
    kind: raw.kind,
    scope: raw.scope,
    ...(raw.seed === undefined ? {} : { seed: raw.seed }),
    ...(raw.tvPreset === undefined ? {} : { tvPreset: raw.tvPreset }),
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

function slots(
  deps: WebPlaybackDeps,
  guildId: ReturnType<typeof GuildIdSchema.parse>,
  channelId: ChannelId,
) {
  return Array.from(
    { length: deps.sessions.numbered.maximum(guildId) },
    (_, index) => {
      const number = PlaybackChannelNumberSchema.parse(index + 1);
      const handle = deps.sessions.getExisting(guildId, channelId, number);
      const view = handle?.view();
      return {
        number,
        label: playbackChannelLabel(number),
        revision: deps.sessions.revision(guildId, channelId, number),
        occupied:
          (handle?.station?.() ?? null) !== null ||
          (view !== undefined &&
            (view.current !== null || view.queue.length > 0)),
      };
    },
  );
}

async function playerItem(
  owner: SnapshotOwner,
  item: ReturnType<SessionHandle["view"]>["queue"][number],
  guildId: string,
  session: WebSession,
) {
  const artworkUrl = owner.deps.catalog.artwork.forSource(
    item.source,
    guildId,
    item.thumbnailUrl ?? item.provenance?.thumbnailUrl,
  );
  return {
    title: owner.deps.catalog.sports.title(item.source) ?? item.title,
    music: item.source?.music !== undefined,
    requester: {
      id: item.requesterId,
      name: await owner.requesterName(session, guildId, item.requesterId),
    },
    queuedAt:
      item.queuedAt ??
      (item.requestId === undefined
        ? undefined
        : owner.deps.commands.history?.queuedAt(item.requestId)) ??
      null,
    durationSeconds: item.durationSeconds,
    mediaKind: item.mediaKind,
    ...(artworkUrl === undefined ? {} : { artworkUrl }),
    ...(item.source?.kind !== "url" ||
    item.source.sportsEvent?.artwork === undefined
      ? {}
      : { sportsArtwork: item.source.sportsEvent.artwork }),
  };
}
