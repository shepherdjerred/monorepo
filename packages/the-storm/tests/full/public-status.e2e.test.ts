import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { parsePortBinding } from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import contract from "@shepherdjerred/the-storm/public-status.json";

async function query(
  host: string,
  port: number,
): Promise<{ names: string[]; count: number; identity: string }> {
  const session = Buffer.from(randomBytes(4).map((value) => value & 15));
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.connect(port, host, resolve);
    });
    const exchange = (request: Buffer) =>
      new Promise<Buffer>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Query timed out")),
          3000,
        );
        socket.once("message", (reply) => {
          clearTimeout(timeout);
          resolve(reply);
        });
        socket.send(request, (error) => {
          if (error !== null) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
    const challenge = await exchange(
      Buffer.concat([Buffer.from([254, 253, 9]), session]),
    );
    expect(challenge.subarray(1, 5)).toEqual(session);
    const token = Buffer.alloc(4);
    token.writeInt32BE(Number(challenge.subarray(5, -1).toString("ascii")));
    const packet = await exchange(
      Buffer.concat([
        Buffer.from([254, 253, 0]),
        session,
        token,
        Buffer.alloc(4),
      ]),
    );
    expect(packet.subarray(1, 5)).toEqual(session);
    const divider = packet.indexOf(Buffer.from("\0\u{1}player_\0\0"));
    expect(divider).toBeGreaterThan(16);
    const fields = packet.subarray(16, divider).toString("utf8").split("\0");
    const stats = new Map<string, string>();
    for (let i = 0; i + 1 < fields.length; i += 2)
      stats.set(z.string().parse(fields[i]), z.string().parse(fields[i + 1]));
    return {
      identity: z.string().parse(stats.get("plugins")),
      count: Number(stats.get("numplayers")),
      names: packet
        .subarray(divider + 11)
        .toString("utf8")
        .split("\0")
        .filter((name) => name !== ""),
    };
  } finally {
    socket.close();
  }
}

describe("public Query on real Paper", () => {
  test("tracks Java joins, vanish, reveal and quits without exposing plugin inventory", async ({
    server,
    bot,
    rcon,
  }) => {
    if (server.kind !== "container")
      throw new Error(
        "This local acceptance test requires the Docker UDP binding",
      );
    const { stdout } = await docker(["port", server.containerId, "25565/udp"]);
    const endpoint = parsePortBinding(stdout);
    const read = () => query(endpoint.host, endpoint.port);
    const before = await read();
    expect(before.identity).toBe(contract.queryIdentity);
    expect(before.names).toContain(bot.username);
    expect(before.count).toBe(before.names.length);
    // GS4 caches full responses for five seconds. These waits belong to local acceptance only.
    await rcon.command(`op ${bot.username}`);
    bot.chat("/vanish");
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const hidden = await read();
    expect(hidden.names).not.toContain(bot.username);
    expect(hidden.count).toBe(hidden.names.length);
    bot.chat("/vanish");
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const revealed = await read();
    expect(revealed.names).toContain(bot.username);
    bot.quit();
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const departed = await read();
    expect(departed.names).not.toContain(bot.username);
  });
});
