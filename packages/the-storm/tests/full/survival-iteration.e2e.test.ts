import { describe, expect } from "vitest";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { startSettlementRound as practice } from "#e2e/harness/settlement.ts";

async function stand(bot: Bot, rcon: RconClient, at: Vec3) {
  await rcon.command(
    `tp ${bot.username} ${at.x.toString()} ${at.y.toString()} ${at.z.toString()}`,
  );
  await waitUntil(
    "test position",
    () => bot.entity.position.distanceTo(at) < 0.5,
  );
}

async function stop(rcon: RconClient) {
  await rcon.command("arena stop settlement");
  await rcon.command("difficulty peaceful");
}

describe("Settlement iteration on native Paper", () => {
  test("shop divider protects icons while inventory rearrangement remains available", async ({
    bot,
    rcon,
  }) => {
    await practice(bot, rcon, 8);
    try {
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      await stand(bot, rcon, new Vec3(1765.5, 73, 2262.5));
      await waitUntil(
        "workbench loaded",
        () => bot.blockAt(new Vec3(1765, 73, 2260)) !== null,
      );
      const block = bot.blockAt(new Vec3(1765, 73, 2260));
      if (block === null) throw new Error("Workbench missing");
      await bot.activateBlock(block);
      await waitUntil("shop opened", () => bot.currentWindow !== null);
      const window = bot.currentWindow;
      if (window === null) throw new Error("Shop missing");
      expect(window.inventoryStart).toBe(54);
      expect(
        window.slots
          .slice(9, 18)
          .every((item) => item?.name === "gray_stained_glass_pane"),
      ).toBe(true);
      expect(window.slots[18]?.name).toBe("stone_sword");
      await bot.clickWindow(9, 0, 1);
      expect(
        bot.inventory
          .items()
          .some((item) => item.name === "gray_stained_glass_pane"),
      ).toBe(false);
      const source = 81 + bot.quickBarSlot;
      const empty = window.slots.slice(54, 81).indexOf(null);
      const original = window.slots[source];
      if (original === null || empty === -1)
        throw new Error("Inventory move fixture missing");
      await bot.clickWindow(source, 0, 0);
      await bot.clickWindow(54 + empty, 0, 0);
      await waitUntil(
        "ordinary inventory moved",
        () => window.slots[54 + empty]?.type === original?.type,
      );
      expect(window.slots[source]).toBeNull();
      await bot.closeWindow(window);
    } finally {
      await stop(rcon);
    }
  }, 60_000);

  test("Loyalty returns the same trident to its throw slot after a kill reward", async ({
    bot,
    rcon,
  }) => {
    await practice(bot, rcon, 8);
    try {
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      await stand(bot, rcon, new Vec3(1815.5, 105, 2167.5));
      await rcon.command(
        `storm-fixture-survival legendary ${bot.username} TIDEBREAKER`,
      );
      await waitUntil("trident delivered", () =>
        bot.inventory.items().some((item) => item.name === "trident"),
      );
      const trident = bot.inventory
        .items()
        .find((item) => item.name === "trident");
      if (trident === undefined) throw new Error("Trident missing");
      await bot.moveSlotItem(trident.slot, 36);
      bot.setQuickBarSlot(0);
      await bot.waitForTicks(2);
      const before = await rcon.command(
        `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data"`,
      );
      await rcon.command(`storm-fixture-survival targets ${bot.username} none`);
      for (const index of [0, 2])
        await rcon.command(
          `data modify entity @e[type=minecraft:zombie,name="Legendary target ${index.toString()}",limit=1] Health set value 5.0f`,
        );
      const selector =
        '@e[type=minecraft:zombie,name="Legendary target 1",limit=1]';
      await rcon.command(
        `data modify entity ${selector} Health set value 1.0f`,
      );
      await waitUntil("trident target", () =>
        Object.values(bot.entities).some(
          (entity) =>
            entity.name === "zombie" &&
            entity.position.distanceTo(new Vec3(1811.5, 105, 2167.5)) < 1,
        ),
      );
      const target = Object.values(bot.entities).find(
        (entity) =>
          entity.name === "zombie" &&
          entity.position.distanceTo(new Vec3(1811.5, 105, 2167.5)) < 1,
      );
      if (target === undefined) throw new Error("Trident target missing");
      const emeralds = bot.inventory
        .items()
        .filter((item) => item.name === "emerald")
        .reduce((total, item) => total + item.count, 0);
      await bot.lookAt(target.position.offset(0, 1.4, 0));
      bot.activateItem();
      await Bun.sleep(1000);
      bot.deactivateItem();
      await waitUntil(
        "trident kill",
        () => bot.entities[target.id] === undefined,
        10_000,
      );
      await waitUntil(
        "kill reward",
        () =>
          bot.inventory
            .items()
            .filter((item) => item.name === "emerald")
            .reduce((total, item) => total + item.count, 0) >=
          emeralds + 2,
        10_000,
      );
      await waitUntil(
        "original trident slot",
        () => bot.inventory.slots[36]?.name === "trident",
        10_000,
      );
      expect(
        await rcon.command(
          `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data"`,
        ),
      ).toBe(before);
      expect(
        bot.inventory.items().filter((item) => item.name === "trident"),
      ).toHaveLength(1);
    } finally {
      bot.deactivateItem();
      await stop(rcon);
    }
  }, 60_000);

  for (const dodge of [false, true])
    test(`locked boss cast ${dodge ? "can be dodged" : "deals actual health damage"}`, async ({
      bot,
      rcon,
    }) => {
      await practice(bot, rcon, 5);
      try {
        await rcon.command(
          `storm-fixture-survival hungry ${bot.username} none`,
        );
        await stand(bot, rcon, new Vec3(1790.5, 73, 2261.5));
        const boss =
          '@e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1]';
        await waitUntil("boss spawned", () =>
          Object.values(bot.entities).some(
            (entity) => entity.name === "breeze",
          ),
        );
        await rcon.command(`tp ${boss} 1787.5 73 2261.5`);
        await rcon.command(`data merge entity ${boss} {NoAI:1b}`);
        for (const slot of ["head", "chest", "legs", "feet", "offhand"])
          await rcon.command(
            `item replace entity ${bot.username} ${slot === "offhand" ? "weapon.offhand" : `armor.${slot}`} with minecraft:air`,
          );
        await waitForMessage(bot, /Breeze Sovereign casts Wind lanes/u, 15_000);
        await rcon.command(
          'execute as @e[type=minecraft:zombie,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}] run data merge entity @s {NoAI:1b}',
        );
        const cast = z
          .object({
            shape: z.literal("WIND_LANES"),
            origin: z.tuple([z.number(), z.number(), z.number()]),
            aim: z.tuple([z.number(), z.number(), z.number()]),
          })
          .parse(
            JSON.parse(
              await rcon.command(
                `storm-fixture-survival cast ${bot.username} none`,
              ),
            ),
          );
        await stand(bot, rcon, new Vec3(...cast.aim));
        if (dodge)
          await stand(
            bot,
            rcon,
            new Vec3(cast.aim[0], cast.aim[1], cast.aim[2] + 3),
          );
        const before = bot.health;
        await waitForMessage(bot, /recovery: attack now/u, 6000);
        await Bun.sleep(150);
        if (dodge) expect(bot.health).toBe(before);
        else expect(bot.health).toBeLessThan(before);
      } finally {
        await stop(rcon);
      }
    }, 60_000);
});
