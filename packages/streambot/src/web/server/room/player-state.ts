import type { WebPlaybackDeps } from "@shepherdjerred/streambot/web/server/playback-deps.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import { IDLE_VIEW } from "@shepherdjerred/streambot/session/session-types.ts";
import {
  PlaybackChannelNumberSchema,
  playbackChannelLabel,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";

/** What building a player needs from `WebPlayback`; both `/api/player` and `/api/room` use it. */
export type SnapshotOwner = {
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

export function webStation(
  handle: SessionHandle | null,
): WebSnapshot["station"] {
  const raw = handle?.station?.() ?? null;
  if (raw === null) return null;
  return {
    kind: raw.kind,
    scope: raw.scope,
    ...(raw.seed === undefined ? {} : { seed: raw.seed }),
    ...(raw.tvPreset === undefined ? {} : { tvPreset: raw.tvPreset }),
  };
}

export async function playerItem(
  owner: SnapshotOwner,
  entry: {
    readonly item: ReturnType<SessionHandle["view"]>["queue"][number];
    readonly token: string | null;
  },
  guildId: string,
  session: WebSession,
) {
  const { item, token } = entry;
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
    ...(token === null ? {} : { token }),
    ...(artworkUrl === undefined ? {} : { artworkUrl }),
    ...(item.source?.kind !== "url" ||
    item.source.sportsEvent?.artwork === undefined
      ? {}
      : { sportsArtwork: item.source.sportsEvent.artwork }),
  };
}

/**
 * The playback fields of one slot, sampled together. A missing handle is an idle slot. `positionAt`
 * is taken in the same synchronous step as the view so a client can extrapolate from it.
 */
export async function playerBody(
  owner: SnapshotOwner,
  handle: SessionHandle | null,
  guildId: string,
  session: WebSession,
) {
  const view = handle?.view() ?? IDLE_VIEW;
  const tokens = handle?.itemTokens() ?? { current: null, queue: [] };
  const positionAt = Date.now();
  const source = view.current?.source;
  return {
    state: view.state,
    current:
      view.current === null
        ? null
        : await playerItem(
            owner,
            { item: view.current, token: tokens.current },
            guildId,
            session,
          ),
    queue: await Promise.all(
      view.queue.map((item, index) =>
        playerItem(
          owner,
          { item, token: tokens.queue[index] ?? null },
          guildId,
          session,
        ),
      ),
    ),
    positionSeconds: view.positionSeconds,
    positionAt,
    paused: view.paused === true,
    volume: view.volume,
    loop: view.loop,
    station: webStation(handle),
    restrictedLive:
      source?.kind === "url" && sportsEventForSource(source.url) !== null,
  };
}

/** The numbered slots of a room with whether each holds anything the viewer should see. */
export function slots(
  deps: WebPlaybackDeps,
  guildId: GuildId,
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
