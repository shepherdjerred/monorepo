import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect } from "vitest";
import type { Bot } from "mineflayer";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot, waitForMessage } from "#e2e/harness/bot.ts";
import { eventually } from "#e2e/harness/rwf-match.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import { e2eProfile, loadResources } from "#e2e/gameplay-fixtures.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

const arenas = ["settlement", "rustworks"] as const;

function leader(players: Bot[]): Bot {
  const player = players.at(-4);
  if (player === undefined) throw new Error("Missing arena leader");
  return player;
}

async function enemies(rcon: RconClient, world: string): Promise<number> {
  const result = await rcon.command(
    `execute in ${world} as @e[nbt={BukkitValues:{"thestorm:arena_entity":"${world}"}}] if data entity @s Health run data get entity @s Health`,
  );
  return result.match(/entity data: [\d.]+f/gu)?.length ?? 0;
}

test(
  "both arenas sustain four players and 48 active enemies on production CPU limits",
  {
    timeout: 300_000,
  },
  async ({ server, rcon }) => {
    expect(e2eProfile()).toBe("load");
    expect(loadResources().cpus).toBe(4);
    if (server.kind !== "container")
      throw new Error("The load probe requires its own container");
    const players: Bot[] = [];
    const windows: { p95: number; settlement: number; rustworks: number }[] =
      [];
    try {
      for (const arena of arenas) {
        await rcon.command(`execute in ${arena} run difficulty normal`);
        for (let index = 0; index < 4; index++) {
          const player = await connectBot({
            host: server.host,
            port: server.gamePort,
            username: `load_${randomBytes(4).toString("hex")}`,
          });
          players.push(player);
          await rcon.command(`op ${player.username}`);
          const joined = waitForMessage(player, /Survival: Fighter/u);
          player.chat(`/arena join ${arena}${index === 0 ? " 13" : ""}`);
          await joined;
        }
        const started = waitForMessage(leader(players), /Round 13:/u);
        await rcon.command(`arena start ${arena}`);
        await started;
      }
      for (const player of players) {
        await rcon.command(
          `effect give ${player.username} minecraft:resistance infinite 255 true`,
        );
      }
      await eventually(
        "48 enemies in both worlds",
        async () =>
          (await enemies(rcon, "settlement")) === 48 &&
          (await enemies(rcon, "rustworks")) === 48,
        45_000,
      );
      // Settle startup/chunk loading, then collect twelve complete ten-second tick windows.
      // Keep native pursuit active while preventing friendly fire from draining
      // the wave queue during a sustained maximum-population measurement.
      for (const arena of arenas) {
        await rcon.command(
          `execute in ${arena} as @e[nbt={BukkitValues:{"thestorm:arena_entity":"${arena}"}}] if data entity @s Health run effect give @s minecraft:resistance infinite 255 true`,
        );
      }
      await Bun.sleep(20_000);
      for (let sample = 0; sample < 12; sample++) {
        await Bun.sleep(10_000);
        const since = (Date.now() / 1000 - 1).toFixed(3);
        await docker([
          "exec",
          "-u",
          "1000",
          server.containerId,
          "mc-send-to-console",
          "spark tps",
        ]);
        let p95: number | undefined;
        await eventually(
          "spark tick percentiles",
          async () => {
            const output = await docker([
              "logs",
              "--since",
              since,
              server.containerId,
            ]);
            const match = /[\d.]+\/[\d.]+\/(?<p95>[\d.]+)\/[\d.]+;/u.exec(
              `${output.stdout}\n${output.stderr}`,
            );
            if (match?.groups === undefined) return false;
            p95 = Number(match.groups["p95"]);
            return true;
          },
          10_000,
        );
        if (p95 === undefined) throw new Error("Missing measured p95");
        windows.push({
          p95,
          settlement: await enemies(rcon, "settlement"),
          rustworks: await enemies(rcon, "rustworks"),
        });
      }
      const report = {
        cpus: loadResources().cpus,
        players: players.length,
        windows,
      };
      const output = path.join(packageRoot, ".cache/e2e/load/arena-load.json");
      await Bun.write(output, JSON.stringify(report, null, 2));
      console.warn(`Arena load evidence: ${output}\n${JSON.stringify(report)}`);
      expect(windows).toHaveLength(12);
      for (const window of windows) {
        expect.soft(window.p95, "ten-second tick p95").toBeLessThan(50);
        expect.soft(window.settlement).toBe(48);
        expect.soft(window.rustworks).toBe(48);
      }
    } finally {
      for (const arena of arenas) await rcon.command(`arena stop ${arena}`);
      for (const player of players) await disconnectBot(player);
    }
  },
);
