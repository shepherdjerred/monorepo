/** Rooms, players and a signed-in viewer for the client's DOM tests. */
import type { ReactNode } from "react";
import {
  RoomCapabilitiesSchema,
  type WebRoom,
  type WebRoomPlayer,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  RemoteProvider,
  type Me,
} from "@shepherdjerred/streambot/web/client/remote.tsx";
import { INITIAL_CONNECTION } from "@shepherdjerred/streambot/web/client/room/room-connection.ts";

export const ME: Me = {
  user: { userId: "1", username: "viewer", guildIds: ["10"] },
  guilds: [{ id: "10", name: "Home server" }],
  csrfToken: "csrf",
  analyticsId: null,
  bugsink: null,
};

type QueueItem = WebRoomPlayer["queue"][number];

/** A queued item whose title and token both carry `name`. */
export function queued(name: string): QueueItem {
  return {
    title: name,
    token: "token-" + name,
    durationSeconds: 60,
    mediaKind: "music",
  };
}

export function listenPlayer(
  changes: Partial<WebRoomPlayer> = {},
): WebRoomPlayer {
  return {
    slot: 1,
    transport: "listen",
    revision: "r1",
    state: "streaming",
    current: { ...queued("now"), durationSeconds: 300 },
    queue: [],
    positionSeconds: 30,
    positionAt: 5000,
    paused: false,
    volume: 100,
    loop: "off",
    station: null,
    restrictedLive: false,
    ...changes,
  };
}

const EVERYTHING = RoomCapabilitiesSchema.parse(
  Object.fromEntries(
    RoomCapabilitiesSchema.keyof().options.map((key) => [key, true]),
  ),
);

export function roomWith(
  players: readonly WebRoomPlayer[],
  changes: Partial<WebRoom> = {},
): WebRoom {
  return {
    serverTime: 5000,
    browseGuildId: "10",
    guilds: ME.guilds,
    location: {
      guild: { id: "10", name: "Home server" },
      channel: { id: "20", name: "Lounge" },
    },
    capacity: { numbered: true, maxSlots: 4, extraStreamAvailable: true },
    capabilities: EVERYTHING,
    players: [...players],
    ...changes,
  };
}

/** A callback the test never needs: switching servers, reconnecting, opening subtitles. */
export function ignore(): void {
  // Nothing to do.
}

/** `children` inside a remote that shows `room`, as the app does once the stream delivered it. */
export function InRoom(props: { room: WebRoom; children: ReactNode }) {
  return (
    <RemoteProvider
      me={ME}
      view={{
        room: props.room,
        clock: { serverTime: props.room.serverTime, receivedAt: Date.now() },
      }}
      connection={INITIAL_CONNECTION}
      chooseGuild={ignore}
      reconnect={ignore}
    >
      {props.children}
    </RemoteProvider>
  );
}
