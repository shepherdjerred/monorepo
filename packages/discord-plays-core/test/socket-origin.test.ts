import { createServer } from "node:http";
import { io } from "socket.io-client";
import { expect, test } from "vitest";
import { z } from "zod";
import { silentLogger } from "#src/logger.ts";
import { createGameSocket } from "#src/webserver/socket.ts";

test.each([
  ["https://pokebot.sjer.red", true],
  ["https://unrelated.example", false],
  [undefined, false],
])("origin %s is admitted: %s", async (origin, accepted) => {
  const server = createServer();
  const channel = createGameSocket({
    server,
    isCorsEnabled: false,
    requestSchema: z.object({ kind: z.literal("status") }),
    ownedUpgradePaths: [],
    allowedOrigin: "https://pokebot.sjer.red",
    logger: silentLogger,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing server address");
  const client = io(`http://127.0.0.1:${String(address.port)}`, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 2000,
    extraHeaders: origin === undefined ? {} : { Origin: origin },
  });
  try {
    const connected = await new Promise<boolean>((resolve) => {
      client.once("connect", () => {
        resolve(true);
      });
      client.once("connect_error", () => {
        resolve(false);
      });
    });
    expect(connected).toBe(accepted);
  } finally {
    client.disconnect();
    await channel.io.close();
  }
});
