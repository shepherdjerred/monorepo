import { createContext, useContext, useRef, type ReactNode } from "react";
import {
  CommandResultSchema,
  type MeSchema,
  type WebCommand,
  type WebRoom,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { z } from "zod";
import {
  apiRequest,
  postJson,
  type ApiFailure,
  type ApiResult,
} from "./api.ts";
import { roomTarget, type RoomTarget } from "./commands.ts";
import type { ConnectionState } from "./room/room-connection.ts";
import type { RoomView } from "./room/use-room.ts";

export type Me = z.infer<typeof MeSchema>;

/** Everything a control needs: who is signed in, the live room, and a way to send a command. */
export type Remote = {
  readonly me: Me;
  readonly view: RoomView | null;
  readonly room: WebRoom | null;
  readonly target: RoomTarget | null;
  readonly connection: ConnectionState;
  /** The server searched and browsed: where the viewer is, or the one they chose. */
  readonly guildId: string;
  readonly chooseGuild: (guildId: string) => void;
  readonly reconnect: () => void;
  /** The room as it is now, for work that runs later than the render that started it. */
  readonly latestTarget: () => RoomTarget | null;
  readonly latestRoom: () => WebRoom | null;
  readonly send: (
    command: WebCommand,
    signal: AbortSignal,
  ) => Promise<ApiResult<z.infer<typeof CommandResultSchema>>>;
};

/** The failure a play control shows without asking the server: there is nowhere to play. */
export const NO_VOICE: ApiFailure = {
  status: 0,
  code: "no_voice",
  message: "",
  reference: null,
};

const RemoteContext = createContext<Remote | null>(null);

export function RemoteProvider(props: {
  me: Me;
  view: RoomView | null;
  connection: ConnectionState;
  chooseGuild: (guildId: string) => void;
  reconnect: () => void;
  children: ReactNode;
}) {
  const room = props.view?.room ?? null;
  const target = room === null ? null : roomTarget(room);
  const latest = useRef(target);
  latest.current = target;
  const latestRoom = useRef(room);
  latestRoom.current = room;
  const remote: Remote = {
    me: props.me,
    view: props.view,
    room,
    target,
    connection: props.connection,
    guildId: room?.browseGuildId ?? props.me.guilds[0]?.id ?? "",
    chooseGuild: props.chooseGuild,
    reconnect: props.reconnect,
    latestTarget: () => latest.current,
    latestRoom: () => latestRoom.current,
    send: (command, signal) =>
      apiRequest(
        "/api/commands",
        CommandResultSchema,
        postJson(command, props.me.csrfToken, signal),
      ),
  };
  return (
    <RemoteContext.Provider value={remote}>
      {props.children}
    </RemoteContext.Provider>
  );
}

export function useRemote(): Remote {
  const remote = useContext(RemoteContext);
  if (remote === null) throw new Error("useRemote needs a RemoteProvider");
  return remote;
}
