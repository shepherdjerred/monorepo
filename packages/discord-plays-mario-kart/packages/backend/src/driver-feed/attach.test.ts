import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIoServer } from "socket.io";
import { io as ioClient, type Socket } from "socket.io-client";
import WebSocket from "ws";
import {
  DRIVER_FEED_PATH,
  DriverFeedInitSchema,
} from "@discord-plays-mario-kart/common";
import { DriverFeedService } from "./index.ts";

// The load-bearing claim this file exists to prove: a `ws` server mounted on
// /video and Socket.IO's engine.io can share one HTTP server. Attached mode
// (`new WebSocketServer({ server })`) destroys upgrades whose path does not
// match, which would silently break every controller connection — that is a
// production-only failure the unit tests cannot see.

type Harness = {
  readonly server: HttpServer;
  readonly io: SocketIoServer;
  readonly port: number;
};

const started: Harness[] = [];

async function startHarness(): Promise<Harness> {
  const server = createServer();
  const io = new SocketIoServer(server);
  const service = new DriverFeedService({
    config: {
      enabled: true,
      height: 480,
      bitrate_kbps: 2500,
      bitrate_max_kbps: 4000,
      keyframe_interval_frames: 30,
      max_client_buffer_bytes: 2 * 1024 * 1024,
      max_clients: 2,
    },
    video: {
      hardware_acceleration: false,
      vaapi_device: "/dev/dri/renderD128",
      encoder_async_depth: 1,
    },
    frameRate: 30,
  });
  service.setDriverAdmission((socketId) => socketId === "active-driver");
  service.attach(server);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo from a TCP listener");
  }
  const harness: Harness = { server, io, port: address.port };
  started.push(harness);
  return harness;
}

function openFeed(port: number, socketId = "active-driver"): WebSocket {
  const query = new URLSearchParams({ driverSocketId: socketId });
  return new WebSocket(
    `ws://127.0.0.1:${String(port)}${DRIVER_FEED_PATH}?${query.toString()}`,
  );
}

/** First message on a feed socket, which is always the JSON handshake. */
function firstMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data: WebSocket.RawData) => {
      if (!Buffer.isBuffer(data)) {
        reject(
          new TypeError("expected the handshake as a single Buffer frame"),
        );
        return;
      }
      resolve(data.toString("utf8"));
    });
    // Persistent, not `once`: a failing socket can emit more than one error and
    // an unhandled second one aborts the test run.
    socket.on("error", reject);
  });
}

afterEach(async () => {
  for (const harness of started.splice(0)) {
    // Kill live sockets first: both `io.close()` and `server.close()` otherwise
    // wait for connections to drain, and a feed socket never drains on its own.
    harness.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      // `close()` also returns a promise; the callback is what we wait on.
      void harness.io.close(() => {
        resolve();
      });
    });
  }
});

/** Resolve once the client itself reports connected, not just the server. */
function clientConnected(client: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("connect", () => {
      resolve();
    });
    client.once("connect_error", reject);
  });
}

describe("driver feed HTTP attachment", () => {
  it("serves the handshake on /video", async () => {
    const { port } = await startHarness();
    const socket = openFeed(port);
    const raw = await firstMessage(socket);
    socket.close();

    const init = DriverFeedInitSchema.parse(JSON.parse(raw));
    expect(init.codec).toBe("avc1.4D4028");
    expect(init.width).toBe(640);
    expect(init.height).toBe(480);
    expect(init.frameRate).toBe(30);
  });

  it("leaves Socket.IO upgrades alone", async () => {
    const { port, io } = await startHarness();
    const connected = new Promise<void>((resolve) => {
      io.once("connection", () => {
        resolve();
      });
    });

    // Force the websocket transport: polling would succeed even if the upgrade
    // handler were stealing every socket, hiding the exact bug under test.
    const client: Socket = ioClient(`http://127.0.0.1:${String(port)}`, {
      transports: ["websocket"],
    });
    await Promise.all([connected, clientConnected(client)]);
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("keeps both transports working at the same time", async () => {
    const { port, io } = await startHarness();
    const connected = new Promise<void>((resolve) => {
      io.once("connection", () => {
        resolve();
      });
    });

    const feed = openFeed(port);
    const client: Socket = ioClient(`http://127.0.0.1:${String(port)}`, {
      transports: ["websocket"],
    });
    const [raw] = await Promise.all([
      firstMessage(feed),
      connected,
      clientConnected(client),
    ]);

    expect(DriverFeedInitSchema.safeParse(JSON.parse(raw)).success).toBe(true);
    expect(client.connected).toBe(true);
    feed.close();
    client.disconnect();
  });

  it("rejects a client once the viewer cap is reached", async () => {
    const { port } = await startHarness();
    const first = openFeed(port);
    const second = openFeed(port);
    await Promise.all([firstMessage(first), firstMessage(second)]);

    const third = openFeed(port);
    const closeCode = await new Promise<number>((resolve, reject) => {
      third.once("close", resolve);
      third.once("error", reject);
    });

    // 1013 "try again later" — the cap is a bandwidth guard, not a protocol error.
    expect(closeCode).toBe(1013);
    first.close();
    second.close();
  });

  it("rejects a controller that does not hold an active seat", async () => {
    const { port } = await startHarness();
    const socket = openFeed(port, "idle-controller");
    const closeCode = await new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });

    expect(closeCode).toBe(1008);
  });

  it("does not claim upgrades on unrelated paths", async () => {
    const { port } = await startHarness();
    const stray = new WebSocket(`ws://127.0.0.1:${String(port)}/not-the-feed`);
    stray.on("error", () => {
      // Expected: engine.io ends this socket. Swallow so it is not unhandled.
    });
    const outcome = await new Promise<string>((resolve) => {
      stray.once("open", () => {
        resolve("open");
      });
      stray.once("close", () => {
        resolve("closed");
      });
    });

    // Engine.io owns unmatched upgrades and ends them ~1s later. The assertion
    // that matters is that the feed did NOT hand back a handshake for a path it
    // does not serve.
    expect(outcome).toBe("closed");
  });
});
