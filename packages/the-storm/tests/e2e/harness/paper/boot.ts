import {
  publishedPort,
  startAndAwaitDone,
} from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import { verifyRconReady } from "#e2e/harness/boot/rcon-ready.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";

/** Prove native commands execute within the caller's existing Paper boot deadline. */
export async function bootContainer(
  id: string,
  rconPassword: string,
  deadline: number,
): Promise<Omit<ServerInfo & { kind: "container" }, "bootMs">> {
  await startAndAwaitDone(id, deadline, [
    "The Storm failed to enable",
    "Error occurred while enabling",
  ]);
  const game = await publishedPort(id, 25_565);
  const rcon = await publishedPort(id, 25_575);
  await verifyRconReady(rcon, rconPassword, deadline);
  return {
    kind: "container",
    containerId: id,
    host: game.host,
    gamePort: game.port,
    rconPort: rcon.port,
    rconPassword,
  };
}
