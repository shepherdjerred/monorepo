import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  CustomSnapshotEnvelopeSchema,
  DiscordGuildIdSchema,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";
import {
  CUSTOM_SOCKET_STABLE_MILLISECONDS,
  customSocketReconnectDelay,
  isTerminalCustomSocketClose,
} from "@/lib/custom-socket-reconnect";
import { newestCustomSnapshot } from "@/lib/newest-custom-snapshot";

function socketUrl(): string {
  const url = new URL("/api/customs/socket", globalThis.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function useCustomSocket(): void {
  const { auth, guildId } = useActivitySession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const guildInput = useMemo(
    () => ({ guildId: DiscordGuildIdSchema.parse(guildId) }),
    [guildId],
  );

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    let openedAt: number | null = null;
    let terminalClose = false;

    const scheduleReconnect = (): void => {
      const delay = customSocketReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = globalThis.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = (): void => {
      if (!active || socket !== null || reconnectTimer !== null) return;
      const nextSocket = new WebSocket(socketUrl(), [
        "scout-customs",
        auth.activityToken,
      ]);
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        openedAt = Date.now();
      });
      nextSocket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = CustomSnapshotEnvelopeSchema.safeParse(raw);
        if (!parsed.success) return;
        queryClient.setQueryData<CustomNightSnapshot | null>(
          trpc.customs.active.queryKey(guildInput),
          (current) => newestCustomSnapshot(current, parsed.data.snapshot),
        );
      });
      nextSocket.addEventListener("close", (event) => {
        if (socket === nextSocket) socket = null;
        if (!active) return;
        if (isTerminalCustomSocketClose(event.code)) {
          terminalClose = true;
          return;
        }
        if (
          openedAt !== null &&
          Date.now() - openedAt >= CUSTOM_SOCKET_STABLE_MILLISECONDS
        ) {
          reconnectAttempt = 0;
        }
        openedAt = null;
        scheduleReconnect();
      });
    };

    const reconnectWhenOnline = (): void => {
      if (terminalClose || socket !== null || reconnectTimer !== null) return;
      reconnectAttempt = 0;
      connect();
    };

    globalThis.addEventListener("online", reconnectWhenOnline);
    connect();
    return () => {
      active = false;
      globalThis.removeEventListener("online", reconnectWhenOnline);
      if (reconnectTimer !== null) globalThis.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [auth.activityToken, guildInput, queryClient, trpc]);
}
