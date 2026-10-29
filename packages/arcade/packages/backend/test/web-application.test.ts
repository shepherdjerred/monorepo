import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import { games, type GameId } from "@arcade/common/catalog.ts";
import { RoomSnapshotSchema } from "@arcade/common/protocol.ts";
import { silentLogger } from "@shepherdjerred/discord-plays-core/logger.ts";
import {
  createSelfbotPooledUserbot,
  type SelfbotPooledUserbot,
} from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import { openTestDatabase } from "@discord-plays-mario-kart/backend/database/test-database.ts";
import type { GameServerModule } from "#src/games/module.ts";
import { createApplication } from "#src/web/application.ts";
import { StatsStore } from "#src/stats/store.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const user = {
  discordId: "10",
  name: "Player",
  username: "player",
  avatarUrl: null,
};
const publicOrigin = "http://localhost";

async function harness(moderator = async (_guild: string) => false) {
  const root = await mkdtemp(path.join(tmpdir(), "arcade-web-"));
  const db = await openTestDatabase();
  const userbot = createSelfbotPooledUserbot("");
  const entry = { busy: false, userbot, guildIds: new Set(["1", "2"]) };
  const input = vi.fn();
  const clearInput = vi.fn();
  let inVoice = true;
  const modules = new Map<GameId, GameServerModule<SelfbotPooledUserbot>>();
  for (const definition of Object.values(games))
    modules.set(definition.id, {
      definition,
      create: () => ({
        start: async () => {
          /* no external runtime in HTTP tests */
        },
        stop: async () => {
          /* no external runtime */
        },
        input,
        clearInput,
        screenshot: async () => Buffer.alloc(0),
      }),
    });
  const application = createApplication({
    publicOrigin,
    stateRoot: root,
    webAssets: root,
    maxSessions: 2,
    maxHeavySessions: 1,
    auth: {
      identify: async (cookie) =>
        cookie === "fixture-player=10" ? user : undefined,
    },
    access: {
      knownGuild: (guildId) => guildId === "1" || guildId === "2",
      players: () => [user],
      inVoice: () => inVoice,
      moderator,
      startTarget: async () => ({ voiceChannelId: "3", textChannelId: "4" }),
      servers: async () => [],
    },
    pool: {
      acquire: () => {
        if (entry.busy) return null;
        entry.busy = true;
        return entry;
      },
      release: () => {
        entry.busy = false;
      },
      canServe: () => true,
    },
    stats: new StatsStore(db),
    logger: silentLogger,
    enabled: async () => true,
    modules: () => modules,
  });
  application.mountPages();
  await new Promise<void>((resolve) => {
    application.server.listen(0, "127.0.0.1", resolve);
  });
  const address = application.server.address();
  if (address === null || typeof address === "string")
    throw new Error("HTTP server did not bind");
  const base = `http://127.0.0.1:${String(address.port)}`;
  const sockets: Socket[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.disconnect();
    await application.manager.shutdown();
    await application.channel.io.close();
    await userbot.destroy();
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  });
  async function connect() {
    const socket = io(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: publicOrigin, Cookie: "fixture-player=10" },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  return {
    ...application,
    base,
    webAssets: root,
    connect,
    input,
    clearInput,
    leaveVoice: () => {
      inVoice = false;
    },
  };
}

describe("Arcade public pages and controller authority", () => {
  it("keeps records public while requiring sign-in and a matching origin for mutations", async () => {
    const h = await harness();
    const stats = await fetch(h.base + "/api/stats?guildId=1&gameId=mk64");
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({
      guildId: "1",
      gameId: "mk64",
      recent: [],
    });
    const unsigned = await fetch(h.base + "/api/sessions", {
      method: "POST",
      headers: { Origin: publicOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "1", gameId: "mk64" }),
    });
    expect(unsigned.status).toBe(401);
    const foreign = await fetch(h.base + "/api/sessions", {
      method: "POST",
      headers: {
        Origin: "http://foreign.invalid",
        Cookie: "fixture-player=10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ guildId: "1", gameId: "mk64" }),
    });
    expect(foreign.status).toBe(403);
    expect(h.manager.list()).toEqual([]);
  });

  it("does not let a delayed subscription restore an earlier server or moderator scope", async () => {
    const permission = Promise.withResolvers<boolean>();
    const h = await harness(async (guild) =>
      guild === "1" ? permission.promise : false,
    );
    const socket = await h.connect();
    const rooms: string[] = [];
    socket.on("room", (message: unknown) => {
      const room = RoomSnapshotSchema.parse(message);
      rooms.push(room.guildId + ":" + room.gameId);
    });
    socket.emit("request", { kind: "subscribe", guildId: "1", gameId: "mk64" });
    socket.emit("request", {
      kind: "subscribe",
      guildId: "2",
      gameId: "emerald",
    });
    await expect.poll(() => rooms).toEqual(["2:emerald"]);
    permission.resolve(true);
    const serverSocket = h.channel.io.sockets.sockets.get(socket.id ?? "");
    if (serverSocket === undefined) throw new Error("WebSocket disappeared");
    await expect
      .poll(() => [...serverSocket.rooms].filter((room) => room !== socket.id))
      .toEqual(["2:emerald"]);
    h.publish("1", "mk64");
    expect(rooms).toEqual(["2:emerald"]);
  });

  it("never derives page validators from image file mtimes", async () => {
    // Image layers clamp every mtime to one epoch, so a size+mtime validator
    // would let a browser keep a changed same-size page after a release.
    const h = await harness();
    const index = path.join(h.webAssets, "index.html");
    const epoch = new Date("2026-01-01T00:00:00Z");
    await mkdir(path.join(h.webAssets, "assets"));
    await writeFile(path.join(h.webAssets, "assets", "app.js"), "export {};");
    async function page(route: string, html: string) {
      await writeFile(index, html);
      await utimes(index, epoch, epoch);
      const response = await fetch(h.base + route);
      expect(response.status).toBe(200);
      expect(response.headers.get("last-modified")).toBeNull();
      expect(await response.text()).toBe(html);
      return response.headers.get("etag");
    }
    for (const route of ["/", "/index.html"])
      expect(await page(route, "<p>release 1</p>")).toBeNull();
    const assets = await fetch(h.base + "/assets/app.js");
    expect(assets.headers.get("etag")).toBeNull();
    expect(assets.headers.get("last-modified")).toBeNull();
    await assets.arrayBuffer();
    const before = await page("/games/mk64", "<p>release 1</p>");
    const after = await page("/games/mk64", "<p>release 2</p>");
    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("requires the owning tab and current voice membership for input", async () => {
    const h = await harness();
    const result = await h.manager.start({
      guildId: "1",
      gameId: "mk64",
      voiceChannelId: "3",
      textChannelId: "4",
      startedByUserId: "10",
    });
    if (result.kind !== "started")
      throw new Error("Test session did not start");
    const first = await h.connect();
    const second = await h.connect();
    const room = h.manager.room("1", "mk64");
    for (const socket of [first, second])
      socket.emit("request", {
        kind: "subscribe",
        guildId: "1",
        gameId: "mk64",
      });
    const claim = (socket: Socket) => {
      socket.emit("request", {
        kind: "claim",
        sessionId: result.session.id,
        seat: 0,
      });
    };
    claim(first);
    await expect
      .poll(() => room.seatOf(result.session.id, first.id ?? ""))
      .toBe(0);
    claim(second);
    await expect
      .poll(() => room.seatOf(result.session.id, second.id ?? ""))
      .toBe(0);
    const input = {
      kind: "input",
      sessionId: result.session.id,
      state: {
        buttons: ["a"],
        stickX: 0,
        stickY: 0,
        cStickX: 0,
        cStickY: 0,
        triggerL: 0,
        triggerR: 0,
      },
    };
    first.emit("request", input);
    second.emit("request", input);
    await expect.poll(() => h.input.mock.calls.length).toBe(1);
    h.leaveVoice();
    const denied = new Promise<unknown>((resolve) => {
      second.once("denied", resolve);
    });
    second.emit("request", input);
    expect(await denied).toBe("Join the voice channel to play.");
    expect(h.input).toHaveBeenCalledTimes(1);
  });
});
