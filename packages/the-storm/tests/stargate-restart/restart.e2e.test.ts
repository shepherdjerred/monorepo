import { Vec3 } from "vec3";
import { expect } from "vitest";
import {
  docker,
  serverLogs,
} from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { publishedPort } from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { eventually } from "#e2e/harness/rwf-match.ts";
import {
  buildClassicStargateFrame,
  openStargateSign,
} from "#e2e/harness/stargates/gates.ts";

test("an always-open Stargate recovers after Paper restarts", async ({
  bot,
  rcon,
  server,
}) => {
  if (server.kind !== "container")
    throw new Error(
      "Restart acceptance requires an owned disposable Docker server",
    );
  const granted = waitForMessage(bot, /admin set your Mechanic to III/iu);
  await rcon.command(`perks admin set ${bot.username} mechanic 3`);
  await granted;
  await rcon.command("forceload add 384 -16 416 0");
  await rcon.command("fill 395 69 0 415 69 5 minecraft:stone");
  for (const x of [400, 410]) {
    const { right } = await buildClassicStargateFrame(rcon, x, "birch");
    await rcon.command(`tp ${bot.username} ${right}.5 71 3.5`);
    const signPos = new Vec3(x + 1, 72, 1);
    const sign = await openStargateSign(bot, signPos, "birch");
    const name = x === 400 ? "First" : "Second";
    const saved = waitForMessage(
      bot,
      new RegExp(`Stargate ${name} created`, "u"),
    );
    bot.updateSign(sign, x === 400 ? "First\nSecond\n\nA" : "Second\n\n\n");
    await saved;
  }
  await waitUntil("fixed portal opens", async () => {
    const result = await rcon.command(
      "execute if block 400 71 0 minecraft:nether_portal",
    );
    return result.includes("Test passed");
  });
  const before = await serverLogs(server);
  const boots = before.match(/Done \(/gu)?.length ?? 0;
  await rcon.command("save-all flush");
  rcon.close();
  await docker(["stop", "--time", "30", server.containerId]);
  await docker(["start", server.containerId]);
  await eventually(
    "Paper restarts",
    async () => {
      const logs = await serverLogs(server);
      return (logs.match(/Done \(/gu)?.length ?? 0) > boots;
    },
    120_000,
  );
  const port = await publishedPort(server.containerId, 25_575);
  const restored = await RconClient.connect({
    host: port.host,
    port: port.port,
    password: server.rconPassword,
  });
  try {
    await waitUntil(
      "fixed portal reopens after restart",
      async () => {
        const result = await restored.command(
          "execute if block 400 71 0 minecraft:nether_portal",
        );
        return result.includes("Test passed");
      },
      60_000,
    );
    expect(
      await restored.command("execute if block 400 70 0 minecraft:obsidian"),
    ).toContain("Test passed");
    const game = await publishedPort(server.containerId, 25_565);
    const reconnected = await connectBot({
      host: game.host,
      port: game.port,
      username: bot.username,
    });
    try {
      await restored.command(`tp ${reconnected.username} 411.5 71 3.5`);
      await waitUntil(
        "owner reaches the destination sign",
        () => Math.abs(reconnected.entity.position.x - 411.5) < 0.3,
      );
      const signPos = new Vec3(411, 72, 1);
      await waitUntil(
        "destination sign loaded after restart",
        () => reconnected.blockAt(signPos)?.name === "birch_wall_sign",
      );
      const sign = reconnected.blockAt(signPos);
      if (sign === null)
        throw new Error("Destination sign missing after restart");
      await reconnected.dig(sign);
      await waitUntil(
        "recovered portal closes after destination removal",
        async () => {
          const result = await restored.command(
            "execute if block 400 71 0 minecraft:air",
          );
          return result.includes("Test passed");
        },
      );
    } finally {
      await disconnectBot(reconnected);
    }
  } finally {
    restored.close();
  }
}, 180_000);
