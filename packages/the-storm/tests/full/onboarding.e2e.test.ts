import { describe, expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot, waitUntil } from "#e2e/harness/bot.ts";

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
});
