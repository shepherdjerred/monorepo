import { createServer } from "node:http";
import { Server as SocketIoServer } from "socket.io";
import { io as socketIoClient } from "socket.io-client";
import { afterEach, expect, test } from "vitest";

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(async (close) => close()));
});

function waitForListening(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function rejectedUpgrade(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(
      () => reject(new Error("protocol-mismatched upgrade was not rejected")),
      2000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("protocol-mismatched upgrade was accepted"));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function validConnection(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = socketIoClient(url, {
      forceNew: true,
      reconnection: false,
      timeout: 2000,
    });
    client.once("connect", () => {
      client.close();
      resolve();
    });
    client.once("connect_error", reject);
  });
}

test("rejects an existing-session upgrade with a mismatched protocol", async () => {
  const httpServer = createServer();
  const io = new SocketIoServer(httpServer);
  cleanup.push(
    () =>
      new Promise((resolve) => {
        void io.close(() => resolve());
      }),
  );
  await waitForListening(httpServer);
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind to a TCP port");
  }
  const origin = `http://127.0.0.1:${address.port.toString()}`;

  const handshake = await fetch(
    `${origin}/socket.io/?EIO=4&transport=polling&t=security-regression`,
  );
  expect(handshake.status).toBe(200);
  const payload = await handshake.text();
  expect(payload.startsWith("0")).toBe(true);
  const session: unknown = JSON.parse(payload.slice(1));
  if (
    typeof session !== "object" ||
    session === null ||
    !("sid" in session) ||
    typeof session.sid !== "string"
  ) {
    throw new Error("Engine.IO handshake did not return a session ID");
  }

  await rejectedUpgrade(
    `${origin.replace("http", "ws")}/socket.io/?transport=websocket&sid=${encodeURIComponent(session.sid)}`,
  );

  await validConnection(origin);
});
