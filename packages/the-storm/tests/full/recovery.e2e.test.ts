import { describe, expect } from "vitest";
import { test } from "#e2e/arena-fixtures.ts";
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
    // Keep the platform inside the initially open Gatehouse combat area:
    // survival containment returns fighters outside it to a ground-level route.
    // This platform and game rule exist only on the disposable test server.
    await rcon.command("gamerule natural_health_regeneration false");
    await rcon.command("fill -42 100 36 -34 100 44 stone");
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 1:/u);
      await rcon.command("arena start settlement");
      await round;
      for (const player of [bot, secondBot]) {
        await rcon.command(`minecraft:tp ${player.username} -37.5 101 40.5`);
      }
      await waitUntil("isolated recovery platform", () =>
        [bot, secondBot].every((player) => player.entity.position.y === 101),
      );
      await rcon.command(`damage ${bot.username} 15 minecraft:generic`);
      await waitUntil("injured survivor", () => bot.health === 5);
      // Keep the live round's mobs from resetting passive recovery while the
      // test observes its one-third ceiling.
      for (const player of [bot, secondBot]) {
        await rcon.command(
          `effect give ${player.username} minecraft:resistance infinite 255 true`,
        );
      }
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
      ).catch(async (error: unknown) => {
        const health = await rcon.command(
          `data get entity ${bot.username} Health`,
        );
        const maximum = await rcon.command(
          `attribute ${bot.username} minecraft:max_health get`,
        );
        throw new Error(
          `Passive recovery stalled: client=${bot.health.toString()}; ${health}; ${maximum}`,
          { cause: error },
        );
      });
      await Bun.sleep(8000);
      expect(bot.health).toBeCloseTo(20 / 3, 3);
      for (const player of [bot, secondBot])
        expect(player.entity.position.y).toBeGreaterThan(100);

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
      await rcon.command("fill -42 100 36 -34 100 44 air");
      await rcon.command("difficulty peaceful");
    }
    await waitUntil("health restored after leaving", () => bot.health === 20);
  });
});
