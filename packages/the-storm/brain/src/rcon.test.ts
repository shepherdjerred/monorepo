import net from "node:net";
import { describe, expect, it } from "vitest";
import { RconClient } from "./rcon.ts";

async function startServer(
  rejectAuth = false,
  malformedLength?: number,
): Promise<{
  port: number;
  closed: Promise<void>;
  close: () => Promise<void>;
}> {
  let connection: net.Socket | undefined;
  let socketClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    socketClosed = resolve;
  });
  const server = net.createServer((socket) => {
    connection = socket;
    socket.on("close", () => {
      socketClosed();
    });
    socket.on("data", (request: Buffer) => {
      if (malformedLength !== undefined) {
        const malformed = Buffer.alloc(4);
        malformed.writeInt32LE(malformedLength, 0);
        socket.write(malformed);
        return;
      }
      const id = request.readInt32LE(4);
      const type = request.readInt32LE(8);
      const body = Buffer.from("ok", "utf8");
      const reply = Buffer.alloc(14 + body.length);
      reply.writeInt32LE(10 + body.length, 0);
      reply.writeInt32LE(type === 3 && rejectAuth ? -1 : id, 4);
      reply.writeInt32LE(0, 8);
      body.copy(reply, 12);
      socket.write(reply);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("RCON test server has no TCP address");
  }
  return {
    port: address.port,
    closed,
    close: async () => {
      connection?.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

describe("RCON connection", () => {
  it("stays open while Minecraft login runs between commands", async () => {
    const server = await startServer();
    const client = await RconClient.connect({
      host: "127.0.0.1",
      port: server.port,
      password: "test",
      timeoutMs: 100,
    });
    try {
      expect(await client.command("list")).toBe("ok");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await client.command("list")).toBe("ok");
    } finally {
      client.close();
      await server.close();
    }
  });

  it("closes TCP after rejected authentication", async () => {
    const server = await startServer(true);
    try {
      await expect(
        RconClient.connect({
          host: "127.0.0.1",
          port: server.port,
          password: "wrong",
          timeoutMs: 100,
        }),
      ).rejects.toThrow("RCON authentication rejected");
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("rejects a command after the peer closes during login", async () => {
    const server = await startServer();
    const client = await RconClient.connect({
      host: "127.0.0.1",
      port: server.port,
      password: "test",
      timeoutMs: 100,
    });
    await server.close();
    await expect(client.command("list")).rejects.toThrow("RCON socket closed");
  });

  it.each([9, 5000])("rejects invalid RCON frame length %i", async (length) => {
    const server = await startServer(false, length);
    try {
      await expect(
        RconClient.connect({
          host: "127.0.0.1",
          port: server.port,
          password: "test",
          timeoutMs: 100,
        }),
      ).rejects.toThrow(`Invalid RCON frame length: ${length.toString()}`);
      await expect(server.closed).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
