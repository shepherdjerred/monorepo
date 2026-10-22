import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";
import { brainControlUrl } from "#e2e/harness/fake-brain.ts";

const Probe = z.object({
  zombieAdult: z.boolean(),
  zombieLevel: z.number(),
  creeperLevel: z.number(),
  melee: z.number(),
  ranged: z.number(),
  blast: z.number(),
  normalMelee: z.number(),
  normalRanged: z.number(),
  normalBlast: z.number(),
});

describe("beginner's luck on native Paper", () => {
  test("a fresh active allowance lowers real mob levels and native damage, retaining aggression", async ({
    bot,
    brain,
    rcon,
    server,
    secondBot,
  }) => {
    const beginners = brainControlUrl(brain.port, "/v1/__control/beginners");
    const response = await fetch(beginners, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([bot.player.uuid]),
    });
    expect(response.ok).toBe(true);
    await disconnectBot(bot);
    const player = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: bot.username,
    });
    await disconnectBot(secondBot);
    const veteran = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: secondBot.username,
    });
    try {
      const ready = waitForMessage(
        player,
        /You take 10% of ordinary mob damage/u,
      );
      player.chat("/beginnersluck");
      await ready;
      // Scripted NPC combat bypasses town land protection. Exercise the Citizen
      // at its real home so its normal chunk ownership stays intact.
      const citizen = '@e[nbt={BukkitValues:{"thestorm:npc":"stan"}},limit=1]';
      await rcon.command(`minecraft:tp ${player.username} -35.5 64 3.5`);
      await waitUntil(
        "newcomer reaches the NPC test site",
        () => Math.abs(player.entity.position.x + 35.5) < 0.5,
      );
      await rcon.command("fill -45 63 -5 -25 63 5 minecraft:stone");
      await waitUntil("Citizen is loaded at the test site", async () =>
        /entity data: [\d.]+f/u.test(
          await rcon.command(`data get entity ${citizen} Health`),
        ),
      );
      const citizenHealth = await rcon.command(
        `data get entity ${citizen} Health`,
      );
      const playerHealth = await rcon.command(
        `data get entity ${player.username} Health`,
      );
      await rcon.command(
        `damage ${citizen} 4 minecraft:player_attack by ${player.username}`,
      );
      expect(await rcon.command(`data get entity ${citizen} Health`)).toBe(
        citizenHealth,
      );
      await rcon.command(
        `damage ${player.username} 4 minecraft:mob_attack by ${citizen}`,
      );
      expect(
        await rcon.command(`data get entity ${player.username} Health`),
      ).toBe(playerHealth);
      const warning = waitForMessage(veteran, /Warning 1 of 2/u);
      await rcon.command(
        `damage ${citizen} 1 minecraft:player_attack by ${veteran.username}`,
      );
      await warning;
      expect(await rcon.command(`data get entity ${citizen} Health`)).not.toBe(
        citizenHealth,
      );
      await rcon.command(
        "execute in minecraft:wilds run fill 2995 64 -5 3005 64 5 minecraft:stone",
      );
      await rcon.command(
        `execute in minecraft:wilds run minecraft:tp ${bot.username} 3000.5 65 0.5`,
      );
      await rcon.command(
        `execute in minecraft:wilds run minecraft:tp ${secondBot.username} 3003.5 65 0.5`,
      );
      await waitUntil(
        "both players arrive in wilds",
        () =>
          Math.abs(player.entity.position.x - 3000.5) < 1 &&
          Math.abs(veteran.entity.position.x - 3003.5) < 1,
      );
      // The control account rejoined last. Let vanilla's post-login protection
      // expire before comparing actual health loss for the two players.
      await veteran.waitForTicks(65);
      const result = Probe.parse(
        JSON.parse(
          await rcon.command(
            `storm-fixture-beginners ${bot.username} ${secondBot.username}`,
          ),
        ),
      );
      expect(result.zombieAdult).toBe(true);
      expect(result.zombieLevel).toBe(1);
      expect(result.creeperLevel).toBe(1);
      expect(result.melee).toBeGreaterThan(0);
      expect(result.melee).toBeLessThan(1);
      expect(result.normalMelee, JSON.stringify(result)).toBeGreaterThan(0);
      expect(result.melee / result.normalMelee).toBeCloseTo(0.1, 4);
      expect(result.ranged / result.normalRanged).toBeCloseTo(0.1, 4);
      expect(result.blast / result.normalBlast).toBeCloseTo(0.1, 4);
    } finally {
      await disconnectBot(player);
      await disconnectBot(veteran);
      const reset = await fetch(beginners, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      });
      expect(reset.ok).toBe(true);
    }
  }, 90_000);
});
