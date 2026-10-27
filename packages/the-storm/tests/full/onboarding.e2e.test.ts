import { describe, expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";

describe("newcomer compass on native Paper", () => {
  test("the compass opens the picker and survives reconnect and death", async ({
    bot,
    server,
    rcon,
  }) => {
    await waitUntil(
      "compass in hotbar slot nine",
      () => bot.inventory.slots[44]?.name === "compass",
    );
    let opened = false;
    bot._client.once("show_dialog", () => {
      opened = true;
    });
    bot.setQuickBarSlot(8);
    bot.activateItem();
    await waitUntil("compass reopens the biome picker", () => opened);
    bot.deactivateItem();
    expect(bot.inventory.slots[44]?.name).toBe("compass");
    await disconnectBot(bot);
    const returning = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: bot.username,
    });
    try {
      await waitUntil(
        "compass survives reconnect",
        () => returning.inventory.slots[44]?.name === "compass",
      );
      await rcon.command(`minecraft:tp ${returning.username} 4000.5 65 0.5`);
      let died = false;
      returning.once("death", () => {
        died = true;
      });
      await rcon.command(`kill ${returning.username}`);
      await waitUntil("player death observed", () => died);
      await waitUntil(
        "player respawns with compass",
        () =>
          returning.health > 0 &&
          returning.inventory.slots[44]?.name === "compass",
      );
      expect(
        returning.inventory.items().filter((item) => item.name === "compass"),
      ).toHaveLength(1);
    } finally {
      await disconnectBot(returning);
    }
  });

  test("compasses can be discarded and Return recovers beside an unsafe column", async ({
    bot,
    rcon,
  }) => {
    await waitUntil(
      "starter compass arrives",
      () => bot.inventory.slots[44]?.name === "compass",
    );
    const compass = bot.inventory.slots[44];
    if (compass == null) throw new Error("starter compass missing");
    await bot.tossStack(compass);
    await waitUntil(
      "starter compass stays discarded",
      () => bot.inventory.slots[44] == null,
    );

    await rcon.command(
      "execute in minecraft:frontier run forceload add 3000 0",
    );
    await rcon.command(
      "execute in minecraft:frontier run fill 3000 -64 0 3000 90 0 minecraft:lava",
    );
    await rcon.command(
      "execute in minecraft:frontier run fill 3001 60 0 3001 63 0 minecraft:stone",
    );
    await rcon.command(
      "execute in minecraft:frontier run fill 3001 64 0 3001 90 0 minecraft:air",
    );
    expect(
      await rcon.command(
        "execute in minecraft:frontier if block 3000 -61 0 minecraft:lava",
      ),
    ).toContain("Test passed");
    expect(
      await rcon.command(
        "execute in minecraft:frontier if block 3001 63 0 minecraft:stone",
      ),
    ).toContain("Test passed");
    let firstDeath = false;
    bot.once("death", () => {
      firstDeath = true;
    });
    await rcon.command(
      `execute in minecraft:frontier run minecraft:tp ${bot.username} 3000.5 64 0.5`,
    );
    await rcon.command(`kill ${bot.username}`);
    await waitUntil(
      "Return arrives after unsafe death",
      () =>
        firstDeath &&
        bot.health > 0 &&
        bot.inventory.slots[43]?.name === "recovery_compass",
    );
    await rcon.command(
      "execute in minecraft:frontier run fill 3001 64 0 3001 90 0 minecraft:air",
    );
    bot.setQuickBarSlot(7);
    bot.activateItem();
    await bot.waitForTicks(40);
    expect(Math.abs(bot.entity.position.x - 3000.5)).toBeLessThanOrEqual(8);
    expect(Math.abs(bot.entity.position.z - 0.5)).toBeLessThanOrEqual(8);
    expect(bot.health).toBeGreaterThan(0);
    expect(bot.inventory.slots[43]?.name).not.toBe("recovery_compass");

    let secondDeath = false;
    bot.once("death", () => {
      secondDeath = true;
    });
    await rcon.command(`kill ${bot.username}`);
    await waitUntil(
      "second Return arrives",
      () =>
        secondDeath &&
        bot.health > 0 &&
        bot.inventory.slots[43]?.name === "recovery_compass",
    );
    const token = bot.inventory.slots[43];
    if (token == null) throw new Error("Return missing");
    await bot.tossStack(token);
    await waitUntil(
      "Return can be thrown away",
      () => bot.inventory.slots[43] == null,
    );
    await rcon.command(
      "execute in minecraft:frontier run forceload remove 3000 0",
    );
  }, 60_000);

  test("only the first human into an empty server gets a clear morning", async ({
    server,
    rcon,
  }) => {
    await rcon.command("execute in minecraft:overworld run time set 18000");
    await rcon.command("execute in minecraft:overworld run weather rain");
    const first = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: "clear_first",
    });
    try {
      await waitUntil(
        "first join clears morning",
        () => first.time.timeOfDay < 2000 && !first.isRaining,
      );
      const clear = waitForMessage(first, /the skies are clear/u);
      first.chat("/crier");
      await clear;
      await rcon.command("execute in minecraft:overworld run time set 18000");
      await rcon.command("execute in minecraft:overworld run weather rain");
      const second = await connectBot({
        host: server.host,
        port: server.gamePort,
        username: "clear_second",
      });
      try {
        await second.waitForTicks(20);
        expect(second.time.timeOfDay).toBeGreaterThan(12_000);
        const rain = waitForMessage(second, /rain falls/u);
        second.chat("/crier");
        await rain;
      } finally {
        await disconnectBot(second);
      }
    } finally {
      await disconnectBot(first);
    }
  });
});
