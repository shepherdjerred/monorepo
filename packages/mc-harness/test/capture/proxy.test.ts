import { createServer, createConnection } from "node:net";
import { it, expect } from "vitest";
import { startCaptureProxy } from "#src/providers/docker/proxy.ts";

it("binds on loopback and forwards admission metadata before buffered Minecraft bytes", async () => {
  const received = Promise.withResolvers<string>();
  const backend = createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (data.endsWith("minecraft-handshake")) {
        received.resolve(data);
        socket.end("server-response");
      }
    });
    socket.on("error", received.reject);
  });
  await new Promise<void>((resolve) => {
    backend.listen(0, "127.0.0.1", resolve);
  });
  const address = backend.address();
  if (address === null || typeof address === "string")
    throw new Error("No test backend address");
  const proxy = await startCaptureProxy({
    host: "127.0.0.1",
    port: address.port,
  });
  const client = createConnection(proxy.endpoint);
  try {
    expect(proxy.endpoint.host).toBe("127.0.0.1");
    const response = Promise.withResolvers<string>();
    client.on("error", response.reject);
    client.on("data", (data) => {
      response.resolve(data.toString());
    });
    client.write("minecraft-handshake");
    expect(await received.promise).toBe(
      `PROXY TCP4 198.51.100.10 127.0.0.1 40000 ${address.port.toString()}\r\nminecraft-handshake`,
    );
    expect(await response.promise).toBe("server-response");
  } finally {
    client.destroy();
    proxy.close();
    await new Promise<void>((resolve, reject) => {
      backend.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
