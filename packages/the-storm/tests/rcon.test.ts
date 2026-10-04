import net from "node:net";
import { afterEach, expect, it } from "vitest";
import { RconClient } from "./e2e/harness/rcon.ts";

const servers: { server: net.Server; sockets: Set<net.Socket> }[] = [];

function packet(id: number, body: string): Buffer {
  const payload = Buffer.from(body);
  const reply = Buffer.alloc(14 + payload.length);
  reply.writeInt32LE(10 + payload.length, 0);
  reply.writeInt32LE(id, 4);
  reply.writeInt32LE(0, 8);
  payload.copy(reply, 12);
  return reply;
}

async function fakeServer(
  rejectAuth = false,
  malformedLength?: number,
): Promise<number> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    let received = Buffer.alloc(0);
    socket.on("data", (data) => {
      received = Buffer.concat([received, Buffer.from(data)]);
      while (received.length >= 4) {
        const length = received.readInt32LE(0);
        if (received.length < length + 4) return;
        const id = received.readInt32LE(4);
        const type = received.readInt32LE(8);
        received = received.subarray(length + 4);
        if (malformedLength !== undefined) {
          const malformed = Buffer.alloc(4);
          malformed.writeInt32LE(malformedLength, 0);
          socket.write(malformed);
          continue;
        }
        socket.write(
          packet(
            type === 3 && rejectAuth ? -1 : id,
            type === 3 ? "" : "There are 0 of a max of 20 players online:",
          ),
        );
      }
    });
  });
  servers.push({ server, sockets });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("missing test server port");
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async ({ server, sockets }) => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }),
  );
});

it.each([9, 5000])("rejects invalid RCON frame length %i", async (length) => {
  const port = await fakeServer(false, length);
  await expect(
    RconClient.connect({
      host: "127.0.0.1",
      port,
      password: "test-only",
      timeoutMs: 100,
    }),
  ).rejects.toThrow(`Invalid RCON frame length: ${length.toString()}`);
  await new Promise<void>((resolve) => {
    const check = () => {
      if (servers[0]?.sockets.size === 0) resolve();
      else setTimeout(check, 1);
    };
    check();
  });
});

it("keeps authenticated RCON idle while still timing active commands", async () => {
  const port = await fakeServer();
  const rcon = await RconClient.connect({
    host: "127.0.0.1",
    port,
    password: "test-only",
    timeoutMs: 100,
  });
  try {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
    expect(await rcon.command("list")).toBe(
      "There are 0 of a max of 20 players online:",
    );
  } finally {
    rcon.close();
  }
});

it("closes TCP after rejected authentication", async () => {
  const port = await fakeServer(true);
  await expect(
    RconClient.connect({ host: "127.0.0.1", port, password: "wrong" }),
  ).rejects.toThrow("RCON authentication rejected");
  await new Promise<void>((resolve) => {
    const check = () => {
      if (servers[0]?.sockets.size === 0) resolve();
      else setTimeout(check, 1);
    };
    check();
  });
});

it("replays an already-lost RCON connection to a later session subscriber", async () => {
  const port = await fakeServer();
  const rcon = await RconClient.connect({
    host: "127.0.0.1",
    port,
    password: "test-only",
  });
  const lost = new Promise<Error>((resolve) => {
    rcon.onFailure(resolve);
  });
  for (const socket of servers[0]?.sockets ?? []) socket.destroy();
  const failure = await lost;
  const later: Error[] = [];
  rcon.onFailure((error) => {
    later.push(error);
  });
  expect(later).toEqual([failure]);
  await expect(rcon.command("list")).rejects.toBe(failure);
});
