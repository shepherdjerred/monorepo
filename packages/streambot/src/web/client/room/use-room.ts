import { useEffect, useReducer, useState } from "react";
import {
  RoomSchema,
  RoomStreamErrorSchema,
  type WebRoom,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  apiRequest,
  apiUrl,
} from "@shepherdjerred/streambot/web/client/api.ts";
import type { RoomClock } from "./position.ts";
import {
  INITIAL_CONNECTION,
  nextConnection,
  refusalFor,
} from "./room-connection.ts";

export type RoomView = {
  readonly room: WebRoom;
  readonly clock: RoomClock;
};

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function parseRoom(data: string): WebRoom | null {
  const parsed = RoomSchema.safeParse(parseJson(data));
  if (parsed.success) return parsed.data;
  console.error("Streambot room event did not match its contract");
  return null;
}

async function refetchRoom(
  params: Readonly<Record<string, string>>,
  accept: (room: WebRoom) => void,
): Promise<void> {
  const result = await apiRequest(apiUrl("/api/room", params), RoomSchema);
  if (result.ok) accept(result.data);
}

/**
 * The viewer's room, pushed over `/api/room/events`. The server sends a full snapshot on every
 * (re)connect, so no event is ever merged into older state. When the browser gives up on the
 * stream (a non-200 answer, or the terminal `unavailable` event) the page waits with backoff,
 * refetches `/api/room` (which also reveals an expired sign-in) and opens a new stream.
 */
export function useRoom(guildHint: string | null, enabled: boolean) {
  const [view, setView] = useState<RoomView | null>(null);
  const [connection, dispatch] = useReducer(nextConnection, INITIAL_CONNECTION);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const params = { guildId: guildHint ?? "" };
    const source = new EventSource(apiUrl("/api/room/events", params));
    let reconnecting = false;
    const accept = (room: WebRoom) => {
      setView({
        room,
        clock: { serverTime: room.serverTime, receivedAt: Date.now() },
      });
    };
    source.addEventListener("open", () => {
      // An automatic reconnect: the new stream's first event is a full snapshot, and the
      // refetch covers anything the page missed while the connection was down.
      if (!reconnecting) return;
      reconnecting = false;
      void refetchRoom(params, accept);
    });
    source.addEventListener("room", (event) => {
      const data: unknown = event.data;
      const room = typeof data === "string" ? parseRoom(data) : null;
      if (room === null) return;
      accept(room);
      dispatch({ type: "room" });
    });
    source.addEventListener("error", (event) => {
      if (event instanceof MessageEvent && typeof event.data === "string") {
        // The server's terminal `error` event: the stream ends after it.
        const parsed = RoomStreamErrorSchema.safeParse(parseJson(event.data));
        source.close();
        dispatch({
          type: "terminal",
          code: parsed.success ? parsed.data.code : "unavailable",
        });
        return;
      }
      const closed = source.readyState === EventSource.CLOSED;
      reconnecting = !closed;
      dispatch({ type: "dropped", closed });
    });
    return () => {
      source.close();
    };
  }, [enabled, guildHint, generation]);

  useEffect(() => {
    if (connection.status !== "waiting") return;
    const controller = new AbortController();
    const retry = async () => {
      const result = await apiRequest(
        apiUrl("/api/room", { guildId: guildHint ?? "" }),
        RoomSchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const reason = result.ok
        ? null
        : refusalFor(result.failure.status, result.failure.code);
      if (reason !== null) {
        dispatch({ type: "refused", reason });
        return;
      }
      if (result.ok)
        setView({
          room: result.data,
          clock: { serverTime: result.data.serverTime, receivedAt: Date.now() },
        });
      dispatch({ type: "reopen" });
      setGeneration((value) => value + 1);
    };
    const timer = setTimeout(() => {
      void retry();
    }, connection.delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [connection, guildHint]);

  return {
    view,
    connection,
    /** Try again after a refusal, for example once the viewer was given access. */
    reconnect: () => {
      dispatch({ type: "reopen" });
      setGeneration((value) => value + 1);
    },
  };
}
