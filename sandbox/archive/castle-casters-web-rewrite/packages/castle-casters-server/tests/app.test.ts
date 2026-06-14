import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createApp } from "#src/app.ts";
import { RoomStore } from "#src/rooms/room-store.ts";

const createRoomResponseSchema = z.object({
  roomId: z.string(),
  lobby: z.object({
    ready: z.boolean(),
  }),
});

describe("server app", () => {
  test("returns health", async () => {
    const { app } = createApp();
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  test("creates rooms", async () => {
    const { app } = createApp();
    const response = await app.request("/rooms", {
      method: "POST",
      body: JSON.stringify({ mapId: "grass", playerCount: 2 }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    const body = createRoomResponseSchema.parse(await response.json());
    expect(typeof body.roomId).toBe("string");
    expect(body.lobby.ready).toBe(false);
  });

  test("creates Java-parity map variants with matching board sizes", () => {
    const roomStore = new RoomStore();
    const grassBig = roomStore.createRoom({ mapId: "grassBig", playerCount: 2 });
    roomStore.hello(grassBig.id, { clientId: "one", name: "one" });
    roomStore.fillSlotsWithAi(grassBig.id);
    roomStore.startMatch(grassBig.id);
    expect(grassBig.match?.settings.boardSize).toBe(11);

    const desertBig = roomStore.createRoom({ mapId: "desertBig", playerCount: 2 });
    roomStore.hello(desertBig.id, { clientId: "one", name: "one" });
    roomStore.fillSlotsWithAi(desertBig.id);
    roomStore.startMatch(desertBig.id);
    expect(desertBig.match?.settings.boardSize).toBe(7);
  });

  test("fills every active empty slot with AI using Java element names", () => {
    const roomStore = new RoomStore();
    const room = roomStore.createRoom({ playerCount: 4 });
    roomStore.hello(room.id, { clientId: "human", name: "human" });
    roomStore.fillSlotsWithAi(room.id);
    const lobby = roomStore.toLobbySnapshot(room);
    expect(lobby.ready).toBe(true);
    expect(lobby.players.map((player) => player.element).toSorted()).toEqual(["earth", "fire", "ice", "wind"]);
  });

  test("rejects malformed websocket JSON without throwing", () => {
    const { websocket } = createApp();
    const socket = fakeSocket("missing-room");
    websocket.message(socket as never, "{");
    expect(socket.sent.at(-1)).toContain("Invalid JSON");
  });

  test("rejects unknown websocket rooms instead of creating a different room", () => {
    const { websocket } = createApp();
    const socket = fakeSocket("missing-room");
    websocket.message(socket as never, JSON.stringify({ type: "hello", v: 1, clientId: "client", name: "player" }));
    expect(socket.sent.at(-1)).toContain("Unknown room");
  });
});

function fakeSocket(roomId: string): {
  data: { roomId: string; clientId?: string };
  sent: string[];
  send: (message: string) => void;
  publish: () => void;
  subscribe: () => void;
} {
  const socket = {
    data: { roomId },
    sent: [] as string[],
    send(message: string) {
      socket.sent.push(message);
    },
    publish() {
      socket.sent.push("__publish__");
    },
    subscribe() {
      socket.sent.push("__subscribe__");
    },
  };
  return socket;
}
