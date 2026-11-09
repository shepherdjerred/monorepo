import { describe, expect, onTestFinished } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";

const { newcomerSpawn } = z
  .object({ newcomerSpawn: z.object({ x: z.number(), z: z.number() }) })
  .parse(
    Bun.YAML.parse(
      await Bun.file(
        new URL(
          "../../../server/owned/plugins/TheStorm/essentials.yml",
          import.meta.url,
        ),
      ).text(),
    ),
  );

describe("restored homes", () => {
  test("a missing native bed becomes an ordinary bed home and respawn", async ({
    server,
    rcon,
  }) => {
    await rcon.command("forceload add 1000 1000");
    await rcon.command("fill 998 69 998 1003 69 1003 minecraft:stone");
    await rcon.command("fill 998 70 998 1003 73 1003 minecraft:air");
    await rcon.command("forceload add 900 1000");
    await rcon.command("fill 898 69 998 902 69 1002 minecraft:stone");
    const player = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: "HistoryBedC",
    });
    onTestFinished(async () => disconnectBot(player));
    await waitUntil(
      "initial placement",
      () =>
        Math.abs(player.entity.position.x - newcomerSpawn.x) < 2 &&
        Math.abs(player.entity.position.z - newcomerSpawn.z) < 2,
    );
    const listed = waitForMessage(player, /bed/);
    player.chat("/homes");
    await listed;
    player.chat("/home bed");
    await waitUntil(
      "restored bed home arrival",
      () =>
        Math.abs(player.entity.position.x - 1000.5) < 6 &&
        Math.abs(player.entity.position.z - 1000.5) < 6,
      30_000,
    );
    await rcon.command(`minecraft:tp ${player.username} 900.5 70 1000.5`);
    await waitUntil(
      "player reaches wilderness",
      () => Math.abs(player.entity.position.x - 900.5) < 2,
    );
    const death = new Promise<void>((resolve) => player.once("death", resolve));
    const killed = await rcon.command(`minecraft:kill ${player.username}`);
    await Promise.race([
      death,
      Bun.sleep(5000).then(() => {
        throw new Error(`Player did not die: ${killed}`);
      }),
    ]);
    player.respawn();
    await waitUntil(
      "respawn at restored bed home",
      () =>
        player.health > 0 &&
        Math.abs(player.entity.position.x - 1000.5) < 6 &&
        Math.abs(player.entity.position.z - 1000.5) < 6,
      30_000,
    );
  });

  test("uses normal home commands without changing an existing vanilla respawn", async ({
    server,
    rcon,
  }) => {
    const messages: string[] = [];
    const player = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: "HistoryBedA",
      onMessage: (line) => messages.push(line),
    });
    onTestFinished(async () => disconnectBot(player));
    await waitUntil(
      "initial spawn",
      () =>
        Math.abs(player.entity.position.x - newcomerSpawn.x) < 2 &&
        Math.abs(player.entity.position.z - newcomerSpawn.z) < 2,
    );
    await rcon.command("forceload add 1000 1000");
    await rcon.command("fill 998 69 998 1003 69 1003 minecraft:stone");
    await rcon.command("fill 998 70 998 1003 73 1003 minecraft:air");
    await rcon.command(`spawnpoint ${player.username} 1002 70 1002`);
    let message = waitForMessage(player, /home/i);
    player.chat("/homes");
    await message;
    player.chat("/home");
    await waitUntil(
      "ordinary travel to restored home",
      () =>
        Math.abs(player.entity.position.x - 1000.5) < 6 &&
        Math.abs(player.entity.position.z - 1000.5) < 6,
      30_000,
    );
    message = waitForMessage(player, /deleted|removed/i);
    player.chat("/delhome home");
    await message;
    const respawn = await rcon.command(
      `data get entity ${player.username} respawn`,
    );
    expect(respawn).toContain("1002");
  });
});
