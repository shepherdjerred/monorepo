import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  AccessSchema,
  RoomSnapshotSchema,
  type Access,
  type RoomRequest,
  type RoomSnapshot,
} from "@arcade/common/protocol.ts";
import { StatsSchema } from "@arcade/common/stats.ts";
import { SessionViewSchema, type GameId } from "@arcade/common/catalog.ts";
import { z } from "zod";

export type RoomConnection = {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  error: string | null;
  access: Access | null;
  socket: Socket;
  send: (request: RoomRequest) => void;
};

export function useRoom(guildId: string, gameId: GameId): RoomConnection {
  const client = useQueryClient();
  const socket: Socket = useMemo(
    () => io({ transports: ["websocket"], autoConnect: false }),
    [],
  );
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    const subscribe = () => {
      setConnected(true);
      socket.emit("request", { kind: "subscribe", guildId, gameId });
    };
    const receive = (message: unknown) => {
      const result = RoomSnapshotSchema.safeParse(message);
      if (!result.success) {
        setSnapshot(null);
        setAccess(null);
        setError(
          "Arcade received invalid game data. Reload the panel to reconnect.",
        );
        return;
      }
      if (result.data.guildId === guildId && result.data.gameId === gameId)
        setSnapshot(result.data);
    };
    const invalidate = () => {
      void client.invalidateQueries({ queryKey: ["stats", guildId, gameId] });
    };
    const receiveAccess = (message: unknown) => {
      const result = AccessSchema.safeParse(message);
      if (!result.success) {
        setAccess(null);
        setError(
          "Arcade could not verify your controller access. Reload to reconnect.",
        );
        return;
      }
      setAccess(result.data);
    };
    const disconnect = () => {
      setConnected(false);
      setAccess(null);
    };
    const denied = (message: unknown) => {
      setError(typeof message === "string" ? message : "Request was refused");
    };
    socket
      .on("connect", subscribe)
      .on("room", receive)
      .on("access", receiveAccess)
      .on("stats-changed", invalidate)
      .on("disconnect", disconnect)
      .on("denied", denied)
      .connect();
    return () => {
      socket
        .off("connect", subscribe)
        .off("room", receive)
        .off("access", receiveAccess)
        .off("stats-changed", invalidate)
        .off("disconnect", disconnect)
        .off("denied", denied)
        .disconnect();
    };
  }, [client, guildId, gameId, socket]);
  const send = (request: RoomRequest) => {
    setError(null);
    socket.emit("request", request);
  };
  return { snapshot, connected, error, access, socket, send };
}

export function useStats(guildId: string, gameId: GameId, playerId?: string) {
  return useQuery({
    queryKey: ["stats", guildId, gameId, playerId],
    queryFn: async () => {
      const query = new URLSearchParams({
        guildId,
        gameId,
        ...(playerId === undefined ? {} : { playerId }),
      });
      const response = await fetch(`/api/stats?${query}`);
      if (!response.ok) throw new Error("Could not load game statistics");
      return StatsSchema.parse(await response.json());
    },
  });
}

export async function mutate(
  path: string,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<void> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (
      response.status === 409 &&
      response.headers.get("content-type")?.includes("application/json") ===
        true
    ) {
      const conflict = z
        .strictObject({
          kind: z.enum(["occupied", "save-in-use"]),
          session: SessionViewSchema,
        })
        .parse(await response.json());
      throw new SessionConflict(
        conflict.session,
        conflict.kind === "occupied"
          ? "Your voice channel already has a game running."
          : "This server’s save is already being played in another channel.",
      );
    }
    const message = await response.text();
    throw new Error(message.length > 0 ? message : "Request failed");
  }
}

export class SessionConflict extends Error {
  constructor(
    readonly session: z.infer<typeof SessionViewSchema>,
    message: string,
  ) {
    super(message);
  }
}
