import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { parsePortBinding } from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import {
  publicContract,
  publicQueryMetadata,
} from "#e2e/harness/public-status.ts";

async function query(host: string, port: number) {
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
    expect(packet[0]).toBe(0);
    expect(packet.subarray(1, 5)).toEqual(session);
    expect(packet.subarray(5, 16)).toEqual(
      Buffer.from("splitnum\0\u{80}\0", "latin1"),
    );
    const marker = Buffer.from("\0\u{1}player_\0\0");
    const divider = packet.indexOf(marker);
    expect(divider).toBeGreaterThan(16);
    const fields = packet.subarray(16, divider).toString("utf8").split("\0");
    const stats = new Map<string, string>();
    for (let i = 0; i + 1 < fields.length; i += 2)
      stats.set(z.string().parse(fields[i]), z.string().parse(fields[i + 1]));
    const names = packet
      .subarray(divider + marker.length)
      .toString("utf8")
      .split("\0")
      .filter((name) => name !== "");
    const publicStatus = publicQueryMetadata(
      z.string().parse(stats.get("plugins")),
    );
    const count = z
      .string()
      .regex(/^\d+$/u)
      .transform(Number)
      .pipe(z.number().int().nonnegative())
      .parse(stats.get("numplayers"));
    expect(count).toBe(names.length);
    expect(
      publicStatus.metadata.players.map((player) => player.name).toSorted(),
    ).toEqual(names.toSorted());
    return { ...publicStatus, count, names };
  } finally {
    socket.close();
  }
}

/** Paper's UDP Query listener: the Docker binding, or the declared external port. */
async function queryEndpoint(server: ServerInfo) {
  if (server.kind === "container") {
    const { stdout } = await docker(["port", server.containerId, "25565/udp"]);
    return parsePortBinding(stdout);
  }
  if (server.queryPort === null)
    throw new Error(
      "STORM_E2E_QUERY_PORT must declare the external server's Query port",
    );
  return { host: server.host, port: server.queryPort };
}

describe("public Query on real Paper", () => {
  test("tracks Java joins, vanish, reveal and quits without exposing plugin inventory", async ({
    server,
    bot,
    rcon,
  }) => {
    const endpoint = await queryEndpoint(server);
    const read = () => query(endpoint.host, endpoint.port);
    const before = await read();
    expect(before.identity).toBe(publicContract.queryIdentity);
    expect(before.names).toContain(bot.username);
    expect(before.metadata.players).toContainEqual({
      name: bot.username,
      uuid: bot.player.uuid,
    });
    expect(before.count).toBe(before.names.length);
    // GS4 caches full responses for five seconds. These waits belong to extended acceptance only, never CI.
    await rcon.command(`op ${bot.username}`);
    bot.chat("/vanish");
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const hidden = await read();
    expect(hidden.names).not.toContain(bot.username);
    expect(hidden.metadata.players.map((player) => player.uuid)).not.toContain(
      bot.player.uuid,
    );
    expect(hidden.count).toBe(hidden.names.length);
    bot.chat("/vanish");
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const revealed = await read();
    expect(revealed.names).toContain(bot.username);
    expect(revealed.metadata.players).toContainEqual({
      name: bot.username,
      uuid: bot.player.uuid,
    });
    bot.quit();
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const departed = await read();
    expect(departed.names).not.toContain(bot.username);
    expect(
      departed.metadata.players.map((player) => player.uuid),
    ).not.toContain(bot.player.uuid);
  });
});
