import type { WebPlaybackDeps } from "./playback-deps.ts";
import type { WebSession } from "./session-store.ts";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  GuildIdSchema,
  ChannelIdSchema,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  PlaybackChannelNumberSchema,
  playbackChannelLabel,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import { IDLE_VIEW } from "@shepherdjerred/streambot/session/session-types.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { WebError, requestInput } from "./errors.ts";
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
  viewedSlot?: string | null,
): Promise<WebSnapshot> {
  const deps = owner.deps;
  await owner.authorize(session, guild);
  const guildId = GuildIdSchema.parse(guild);
  const channel = deps.bot.webVoiceChannel(guildId, session.identity.userId);
  let playbackChannel =
    channel === null
      ? undefined
      : await deps.sessions.numbered.selected({
          guildId,
          channelId: channel.id,
          userId: session.identity.userId,
        });
  const selectedPlaybackChannel = playbackChannel ?? null;
  const scope = {
    guildId,
    channelId: channel?.id ?? "web",
    userId: session.identity.userId,
  };
  const automaticRoutingEnabled =
    playbackChannel !== undefined &&
    (await deps.featureGate.automaticChannelRouting?.(scope)) === true;
  if (playbackChannel !== undefined && viewedSlot != null) {
    const viewed = requestInput(
      PlaybackChannelNumberSchema,
      Number(viewedSlot),
    );
    if (viewed > deps.sessions.numbered.maximum(guildId))
      throw new WebError(
        400,
        "invalid_channel",
        "That Streambot channel is unavailable.",
      );
    playbackChannel = viewed;
  }
  const advancedControls =
    channel !== null &&
    (await deps.featureGate.assistantV2({
      guildId,
      channelId: channel.id,
      userId: session.identity.userId,
    }));
  const sportsEnabled = await owner.sportsEnabled(session, guildId);
  const historyEnabled = await owner.historyEnabled(session, guildId);
  // Capture the view and its revision together after asynchronous gate checks.
  const handle =
    channel === null
      ? null
      : deps.sessions.getExisting(guildId, channel.id, playbackChannel);
  const view = handle?.view() ?? IDLE_VIEW;
  const source = view.current?.source;
  return {
    channel,
    playbackChannel: playbackChannel ?? null,
    selectedPlaybackChannel,
    ...selectionState(deps, {
      guildId,
      channel,
      scope,
      playbackChannel,
      automaticRoutingEnabled,
    }),
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
    restrictedLive:
      source?.kind === "url" && sportsEventForSource(source.url) !== null,
  };
}

function selectionState(
  deps: WebPlaybackDeps,
  input: {
    guildId: ReturnType<typeof GuildIdSchema.parse>;
    channel: WebSnapshot["channel"];
    scope: { guildId: string; channelId: string; userId: string };
    playbackChannel: WebSnapshot["playbackChannel"] | undefined;
    automaticRoutingEnabled: boolean;
  },
) {
  const { guildId, channel, scope, playbackChannel, automaticRoutingEnabled } =
    input;
  return {
    selectionVersion:
      channel === null ? null : deps.sessions.numbered.selection.version(scope),
    selectionMode:
      automaticRoutingEnabled &&
      !deps.sessions.numbered.selection.isManual(scope)
        ? ("auto" as const)
        : ("manual" as const),
    automaticRoutingEnabled,
    playbackChannels:
      playbackChannel == null || channel === null
        ? []
        : slots(deps, guildId, ChannelIdSchema.parse(channel.id)),
  };
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
      const view = deps.sessions
        .getExisting(guildId, channelId, number)
        ?.view();
      return {
        number,
        label: playbackChannelLabel(number),
        revision: deps.sessions.revision(guildId, channelId, number),
        occupied:
          view !== undefined &&
          (view.current !== null || view.queue.length > 0),
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
