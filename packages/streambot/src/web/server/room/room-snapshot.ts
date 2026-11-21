import {
  WebError,
  requestInput,
} from "@shepherdjerred/streambot/web/server/errors.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";
import {
  GuildIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  AUDIO_CHANNEL,
  PlaybackChannelNumberSchema,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type {
  WebRoom,
  WebRoomPlayer,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import { roomCapabilities } from "./capabilities.ts";
import { playerBody, slots, type SnapshotOwner } from "./player-state.ts";

export type RoomOwner = SnapshotOwner & {
  plexPostersEnabled: (guildId: string, userId: string) => Promise<boolean>;
};

/** Snowflakes order by creation time; compare as numbers of equal width, not as OAuth order. */
function bySnowflake(left: string, right: string): number {
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

async function isAuthorized(
  owner: SnapshotOwner,
  session: WebSession,
  id: string,
): Promise<boolean> {
  try {
    await owner.authorize(session, id);
    return true;
  } catch (error) {
    if (error instanceof WebError) return false;
    throw error;
  }
}

/**
 * The server to browse when the viewer is in no voice channel: the first they may use. When every
 * server is refused the first refusal is thrown, so the caller reports a real 403 and not an
 * empty room.
 */
async function firstAuthorized(
  owner: SnapshotOwner,
  session: WebSession,
  ids: readonly string[],
): Promise<string> {
  let refusal: WebError | undefined;
  for (const id of ids) {
    try {
      await owner.authorize(session, id);
      return id;
    } catch (error) {
      if (!(error instanceof WebError)) throw error;
      refusal ??= error;
    }
  }
  throw (
    refusal ??
    new WebError(
      403,
      "guild_denied",
      "Choose a server you share with Streambot.",
    )
  );
}

/**
 * Where the viewer is, read from the gateway voice-state cache across the servers they share with
 * Streambot, never from anything the client sent. A server whose web remote is off, or that no
 * longer has the viewer as a member, is ignored. Discord lets a member be connected to voice in
 * one server at a time, so more than one hit means a stale cache entry; the lowest server id wins
 * so the answer does not depend on OAuth guild order or on which request asked.
 */
export async function locateViewer(
  owner: SnapshotOwner,
  session: WebSession,
  guilds: readonly { id: string; name: string }[],
) {
  const inVoice = guilds
    .flatMap((guild) => {
      const channel = owner.deps.bot.webVoiceChannel(
        GuildIdSchema.parse(guild.id),
        session.identity.userId,
      );
      return channel === null ? [] : [{ guild, channel }];
    })
    .toSorted((left, right) => bySnowflake(left.guild.id, right.guild.id));
  for (const entry of inVoice)
    if (await isAuthorized(owner, session, entry.guild.id)) return entry;
  return null;
}

/** A legacy room has one mixed queue; its transport comes from what it holds. */
function legacyTransport(player: {
  current: { mediaKind: "music" | "video" | null; music?: boolean } | null;
  queue: readonly { music?: boolean }[];
  station: { kind: "radio" | "tv" } | null;
}): WebRoomPlayer["transport"] {
  if (player.current?.mediaKind === "music") return "listen";
  if (player.current?.mediaKind === "video") return "watch";
  if (player.station !== null)
    return player.station.kind === "radio" ? "listen" : "watch";
  const music = player.current?.music ?? player.queue[0]?.music;
  return music === true ? "listen" : "watch";
}

function occupied(handle: SessionHandle): boolean {
  const view = handle.view();
  return (
    (handle.station?.() ?? null) !== null ||
    view.current !== null ||
    view.queue.length > 0
  );
}

type RoomPlayers = {
  players: WebRoomPlayer[];
  maxSlots: number;
  /** The command path's own test: the viewer has a selected slot, so the room is numbered. */
  numbered: boolean;
  extra: boolean;
};

/** No players and one mixed queue: a legacy room, or no voice room at all. */
const LEGACY_EMPTY: RoomPlayers = {
  players: [],
  maxSlots: 1,
  numbered: false,
  extra: false,
};

async function roomPlayers(
  owner: SnapshotOwner,
  session: WebSession,
  room: { guildId: GuildId; channelId: ChannelId },
): Promise<RoomPlayers> {
  const { deps } = owner;
  const { guildId, channelId } = room;
  // The room shows a track's song and artists on separate lines.
  const viewer = { guildId, session, titles: "split" } as const;
  const selected = await deps.sessions.numbered.selected({
    guildId,
    channelId,
    userId: session.identity.userId,
  });
  if (selected === undefined) {
    // A legacy queue (or numbered channels being off) is one mixed room: at most one player.
    const handle = deps.sessions.getExisting(guildId, channelId);
    if (handle === null || !occupied(handle)) return LEGACY_EMPTY;
    const { positionAt, ...body } = await playerBody(owner, handle, viewer);
    return {
      players: [
        {
          slot: AUDIO_CHANNEL,
          transport: legacyTransport(body),
          revision: deps.sessions.revision(guildId, channelId),
          positionAt,
          ...body,
        },
      ],
      maxSlots: 1,
      numbered: false,
      extra: false,
    };
  }
  const numbered = slots(deps, guildId, channelId);
  const players: WebRoomPlayer[] = [];
  for (const slot of numbered) {
    if (!slot.occupied) continue;
    const body = await playerBody(
      owner,
      deps.sessions.getExisting(guildId, channelId, slot.number),
      viewer,
    );
    players.push({
      slot: slot.number,
      transport: slot.number === AUDIO_CHANNEL ? "listen" : "watch",
      revision: slot.revision,
      ...body,
    });
  }
  return {
    players,
    maxSlots: numbered.length,
    numbered: true,
    // A third or later stream needs a numbered slot beyond Listen and Watch that nothing holds.
    extra: numbered.some(
      (slot) =>
        slot.number > PlaybackChannelNumberSchema.parse(2) && !slot.occupied,
    ),
  };
}

/**
 * The whole room for one viewer. `guildHint` (the `guildId` query) only chooses a server to browse
 * when the viewer is in no voice channel; it can never move an in-voice viewer's room.
 */
export async function buildRoom(
  owner: RoomOwner,
  session: WebSession,
  guildHint: string | null,
): Promise<WebRoom> {
  const guilds = owner.deps.bot.webGuilds(session.identity.guildIds);
  const located = await locateViewer(owner, session, guilds);
  let browseGuildId: string;
  if (located !== null) browseGuildId = located.guild.id;
  else if (guildHint === null)
    browseGuildId = await firstAuthorized(
      owner,
      session,
      guilds.map((guild) => guild.id),
    );
  else {
    browseGuildId = requestInput(GuildIdSchema, guildHint);
    await owner.authorize(session, browseGuildId);
  }
  const room =
    located === null
      ? null
      : {
          guildId: GuildIdSchema.parse(located.guild.id),
          channelId: located.channel.id,
        };
  const [capabilities, player] = await Promise.all([
    roomCapabilities({
      owner,
      session,
      guildId: browseGuildId,
      channelId: room?.channelId ?? null,
      plexPostersEnabled: owner.plexPostersEnabled,
    }),
    room === null ? LEGACY_EMPTY : roomPlayers(owner, session, room),
  ]);
  return {
    location:
      located === null
        ? null
        : {
            guild: located.guild,
            channel: { id: located.channel.id, name: located.channel.name },
          },
    guilds,
    browseGuildId,
    players: player.players,
    capacity: {
      maxSlots: player.maxSlots,
      numbered: player.numbered,
      extraStreamAvailable: player.extra,
    },
    capabilities,
    serverTime: Date.now(),
  };
}
