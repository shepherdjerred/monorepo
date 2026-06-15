import { clientMessageSchema } from "@castle-casters/core/schemas";
import { Hono } from "hono";
import type { ServerWebSocket } from "bun";
import { RoomStore } from "./rooms/room-store.ts";

type WsData = {
  roomId: string;
  clientId?: string;
};

export type CastleCastersApp = ReturnType<typeof createApp>;

export function createApp(roomStore = new RoomStore()): {
  app: Hono;
  websocket: {
    open: (ws: ServerWebSocket<WsData>) => void;
    message: (ws: ServerWebSocket<WsData>, message: string | Buffer) => void;
    close: (ws: ServerWebSocket<WsData>) => void;
  };
  roomStore: RoomStore;
} {
  const app = new Hono();

  app.get("/health", (context) => {
    return context.json({ ok: true, version: "0.1.0" });
  });

  app.get("/rooms", (context) => {
    return context.json({ rooms: roomStore.listRooms() });
  });

  app.post("/rooms", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const room = roomStore.createRoom({
      mapId: body.mapId,
      playerCount: body.playerCount,
    });
    return context.json({ roomId: room.id, lobby: roomStore.toLobbySnapshot(room) }, 201);
  });

  app.get("/rooms/:roomId", (context) => {
    const room = roomStore.getRoom(context.req.param("roomId"));
    if (room === undefined) {
      return context.json({ error: "Room not found." }, 404);
    }
    return context.json({ lobby: roomStore.toLobbySnapshot(room), phase: room.phase, match: room.match });
  });

  app.get("/rooms/:roomId/replay", (context) => {
    const room = roomStore.getRoom(context.req.param("roomId"));
    if (room === undefined) {
      return context.json({ error: "Room not found." }, 404);
    }
    return context.json({ replay: room.replay });
  });

  app.get("/rooms/:roomId/ws", (context) => {
    const upgraded = serverUpgrade(context.req.raw, {
      data: { roomId: context.req.param("roomId") },
    });
    if (upgraded) {
      return new Response(null);
    }
    return context.text("WebSocket upgrade failed.", 400);
  });

  return {
    app,
    websocket: {
      open() {
        // Client must send hello before the session is bound.
      },
      message(ws, rawMessage) {
        let json: unknown;
        try {
          json = JSON.parse(String(rawMessage));
        } catch {
          ws.send(JSON.stringify({ type: "commandRejected", serverSeq: 0, reason: "Invalid JSON.", errors: ["Message must be valid JSON."] }));
          return;
        }
        const parsed = clientMessageSchema.safeParse(json);
        if (!parsed.success) {
          ws.send(JSON.stringify({ type: "commandRejected", serverSeq: 0, reason: "Invalid message.", errors: parsed.error.issues.map((issue) => issue.message) }));
          return;
        }

        const message = parsed.data;
        if (message.type === "hello") {
          ws.data.clientId = message.clientId;
          ws.subscribe(ws.data.roomId);
          const result = safeRoomCommand(ws, () =>
            roomStore.hello(ws.data.roomId, {
              clientId: message.clientId,
              name: message.name,
              ...(message.resumeToken === undefined ? {} : { resumeToken: message.resumeToken }),
            }),
          );
          if (result === undefined) {
            return;
          }
          for (const outgoing of result.messages) {
            ws.send(JSON.stringify(outgoing));
          }
          return;
        }

        if (ws.data.clientId === undefined) {
          ws.send(JSON.stringify({ type: "commandRejected", serverSeq: 0, reason: "Session is not identified.", errors: ["Send hello first."] }));
          return;
        }
        const clientId = ws.data.clientId;

        const messages = safeRoomCommand(ws, () =>
          message.type === "startMatchRequested"
            ? roomStore.startMatch(ws.data.roomId)
            : message.type === "fillSlotsWithAiRequested"
              ? roomStore.fillSlotsWithAi(ws.data.roomId)
              : message.type === "turnSubmitted"
                ? roomStore.submitTurn(ws.data.roomId, clientId, message.clientSeq, message.turn)
                : message.type === "requestSnapshot"
                  ? [roomStore.snapshot(ws.data.roomId)]
                  : [{ type: "pong", serverSeq: 0, clientSeq: message.clientSeq } as const],
        );
        if (messages === undefined) {
          return;
        }

        for (const outgoing of messages) {
          ws.publish(ws.data.roomId, JSON.stringify(outgoing));
          ws.send(JSON.stringify(outgoing));
        }
      },
      close(ws) {
        if (ws.data.clientId !== undefined) {
          const message = roomStore.disconnect(ws.data.roomId, ws.data.clientId);
          if (message !== undefined) {
            ws.publish(ws.data.roomId, JSON.stringify(message));
          }
        }
      },
    },
    roomStore,
  };
}

let upgradeHandler: ((request: Request, options: { data: WsData }) => boolean) | undefined;

export function setUpgradeHandler(handler: (request: Request, options: { data: WsData }) => boolean): void {
  upgradeHandler = handler;
}

function serverUpgrade(request: Request, options: { data: WsData }): boolean {
  if (upgradeHandler === undefined) {
    return false;
  }
  return upgradeHandler(request, options);
}

function safeRoomCommand<T>(ws: ServerWebSocket<WsData>, action: () => T): T | undefined {
  try {
    return action();
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: "commandRejected",
        serverSeq: 0,
        reason: error instanceof Error ? error.message : "Room command failed.",
        errors: [error instanceof Error ? error.message : "Room command failed."],
      }),
    );
    return undefined;
  }
}
