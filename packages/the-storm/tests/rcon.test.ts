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
  respond?: (
    socket: net.Socket,
    id: number,
    type: number,
    body: string,
  ) => Promise<void>,
): Promise<number> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    let received = Buffer.alloc(0);
    let responses = Promise.resolve();
    socket.on("data", (data) => {
      received = Buffer.concat([received, Buffer.from(data)]);
      while (received.length >= 4) {
        const length = received.readInt32LE(0);
        if (received.length < length + 4) return;
        const id = received.readInt32LE(4);
        const type = received.readInt32LE(8);
        const body = received.toString("utf8", 12, length + 2);
        received = received.subarray(length + 4);
        if (malformedLength !== undefined) {
          const malformed = Buffer.alloc(4);
          malformed.writeInt32LE(malformedLength, 0);
          socket.write(malformed);
          continue;
        }
        if (type !== 3 && respond !== undefined) {
          const previous = responses;
          responses = (async () => {
            await previous;
            await respond(socket, id, type, body);
          })();
          continue;
        }
        socket.write(
          packet(type === 3 && rejectAuth ? -1 : id, replyBody(type)),
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

function replyBody(type: number): string {
  if (type === 3) return "";
  return type === 0
    ? "Unknown request 0"
    : "There are 0 of a max of 20 players online:";
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

it.each([9, 50_000])("rejects invalid RCON frame length %i", async (length) => {
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

it.each([4096, 8192, 8193])(
  "collects all %i response characters through a completion probe",
  async (length) => {
    const response = "x".repeat(length);
    const requests: { type: number; body: string }[] = [];
    const port = await fakeServer(
      false,
      undefined,
      async (socket, id, type, body) => {
        requests.push({ type, body });
        if (type === 0) {
          socket.write(packet(id, "Unknown request 0"));
          return;
        }
        for (let offset = 0; offset < response.length; offset += 4096) {
          const encoded = packet(id, response.slice(offset, offset + 4096));
          socket.write(encoded.subarray(0, 7));
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          socket.write(encoded.subarray(7));
        }
      },
    );
    const rcon = await RconClient.connect({
      host: "127.0.0.1",
      port,
      password: "test-only",
    });
    try {
      expect(
        await Promise.all([rcon.command("first"), rcon.command("second")]),
      ).toEqual([response, response]);
      expect(requests).toEqual([
        { type: 2, body: "first" },
        { type: 0, body: "" },
        { type: 2, body: "second" },
        { type: 0, body: "" },
      ]);
    } finally {
      rcon.close();
    }
  },
);

it("accepts a full Paper chunk containing multibyte UTF-8", async () => {
  const response = "漢".repeat(4096);
  const port = await fakeServer(false, undefined, async (socket, id, type) => {
    socket.write(packet(id, type === 0 ? "Unknown request 0" : response));
  });
  const rcon = await RconClient.connect({
    host: "127.0.0.1",
    port,
    password: "test-only",
  });
  try {
    expect(await rcon.command("unicode")).toBe(response);
  } finally {
    rcon.close();
  }
});

it("fails and closes the connection when the completion probe never returns", async () => {
  const port = await fakeServer(false, undefined, async (socket, id, type) => {
    if (type === 2) socket.write(packet(id, "partial"));
  });
  const rcon = await RconClient.connect({
    host: "127.0.0.1",
    port,
    password: "test-only",
    timeoutMs: 100,
  });
  const failure = new Promise<Error>((resolve) => rcon.onFailure(resolve));
  await expect(rcon.command("missing-marker")).rejects.toThrow(
    "RCON command timed out",
  );
  const error = await failure;
  expect(error.message).toBe("RCON command timed out");
  await expect(rcon.command("next")).rejects.toThrow("RCON command timed out");
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
