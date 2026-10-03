import { describe, expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

describe("minor survival recovery on real Paper", () => {
  test("recovery caps at one-third, preserves consumables and excludes downed players", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    for (const player of [bot, secondBot]) {
      const joined = waitForMessage(player, /Survival: Fighter/u);
      player.chat("/arena join settlement");
      await joined;
    }
    const selected = waitForMessage(bot, /Selected MEDIC/u);
    bot.chat("/arena class medic");
    await selected;
    // Isolate passive healing from vanilla food healing and enemy attacks.
    // This platform and game rule exist only on the disposable test server.
    await rcon.command("gamerule natural_health_regeneration false");
    await rcon.command("fill 1770 100 2162 1778 100 2170 stone");
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 1:/u);
      await rcon.command("arena start settlement");
      await round;
      for (const player of [bot, secondBot]) {
        await rcon.command(`tp ${player.username} 1774.5 101 2166.5`);
      }
      await rcon.command(`damage ${bot.username} 15 minecraft:generic`);
      await waitUntil("injured survivor", () => bot.health === 5);
      await Bun.sleep(4000);
      expect(bot.health).toBe(5);
      await waitUntil(
        "first half-heart of recovery",
        () => bot.health === 6,
        8000,
      );
      await waitUntil(
        "one-third recovery ceiling",
        () => Math.abs(bot.health - 20 / 3) < 0.001,
      );
      await Bun.sleep(8000);
      expect(bot.health).toBeCloseTo(20 / 3, 3);

      const apple = bot.inventory
        .items()
        .find((item) => item.name === "golden_apple");
      if (apple === undefined)
        throw new Error("Medic's healing food is missing");
      await bot.equip(apple, "hand");
      await bot.consume();
      await waitUntil(
        "healing food passes the passive cap",
        () => bot.health > 8,
      );

      await rcon.command(`effect clear ${bot.username}`);
      const downed = waitForMessage(bot, /Downed!/u);
      await rcon.command(`damage ${bot.username} 100 minecraft:generic`);
      await downed;
      await waitUntil("downed health", () => bot.health === 1);
      await Bun.sleep(9000);
      expect(bot.health).toBe(1);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("gamerule natural_health_regeneration true");
      await rcon.command("fill 1770 100 2162 1778 100 2170 air");
      await rcon.command("difficulty peaceful");
    }
    await waitUntil("health restored after leaving", () => bot.health === 20);
  });
});
