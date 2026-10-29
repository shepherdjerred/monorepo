import { createServer, createConnection, type Socket } from "node:net";

/** Loopback-only admission proxy for isolated, offline real-map demonstrations. */
export async function startCaptureProxy(backend: {
  host: string;
  port: number;
}) {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    client.pause();
    const upstream = createConnection(backend);
    sockets.add(client);
    sockets.add(upstream);
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
    upstream.once("connect", () => {
      // TEST-NET-2 represents a local test peer. It is never sent to a live server.
      upstream.write(
        `PROXY TCP4 198.51.100.10 127.0.0.1 40000 ${backend.port.toString()}\r\n`,
      );
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Local proxy has no TCP address");
  return {
    endpoint: { host: "127.0.0.1", port: address.port },
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
