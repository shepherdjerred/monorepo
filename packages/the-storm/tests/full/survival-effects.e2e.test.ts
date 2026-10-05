import { describe, expect } from "vitest";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { startSettlementRound } from "#e2e/harness/survival.ts";

async function start(bot: Bot, rcon: RconClient) {
  await startSettlementRound(bot, rcon, 8);
  await rcon.command(
    `effect give ${bot.username} minecraft:resistance infinite 255 true`,
  );
  await rcon.command(`tp ${bot.username} 1844.5 105 2177.5`);
  await waitUntil(
    "safe test ground",
    () => bot.entity.position.distanceTo(new Vec3(1844.5, 105, 2177.5)) < 0.6,
  );
}

async function stop(rcon: RconClient) {
  await rcon.command("arena stop settlement");
  await rcon.command("difficulty peaceful");
}

async function grant(bot: Bot, rcon: RconClient, id: string, material: string) {
  await rcon.command(`storm-fixture-survival legendary ${bot.username} ${id}`);
  await waitUntil("effect equipment", () =>
    bot.inventory.items().some((item) => item.name === material),
  );
  const item = bot.inventory
    .items()
    .find((candidate) => candidate.name === material);
  if (item === undefined) throw new Error("Effect equipment missing");
  return item;
}

test("run food and healing potions finish faster with their native effects intact", async ({
  bot,
  rcon,
}) => {
  await start(bot, rcon);
  try {
    await rcon.command(`storm-fixture-survival hungry ${bot.username} none`);
    await waitUntil("food can be eaten", () => bot.food <= 16);
    const bread = bot.inventory.items().find((item) => item.name === "bread");
    if (bread === undefined) throw new Error("Run bread missing");
    await bot.equip(bread, "hand");
    await bot.waitForTicks(2);
    const eating = performance.now();
    await bot.consume();
    expect(performance.now() - eating).toBeGreaterThanOrEqual(850);
    expect(performance.now() - eating).toBeLessThan(1400);
    bot.setQuickBarSlot(0);
    await bot.waitForTicks(2);
    const runData = await rcon.command(
      `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
    );
    const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(runData)?.[0]);
    await rcon.command(
      `give ${bot.username} minecraft:wheat[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] 4`,
    );
    await rcon.command(`tp ${bot.username} 1761.5 89 2189.5`);
    await waitUntil(
      "infirmary loaded",
      () => bot.blockAt(new Vec3(1761, 89, 2188)) !== null,
    );
    const infirmary = bot.blockAt(new Vec3(1761, 89, 2188));
    if (infirmary === null) throw new Error("Infirmary missing");
    await bot.activateBlock(infirmary);
    await waitUntil("healing recipes", () => bot.currentWindow !== null);
    await bot.clickWindow(21, 0, 0);
    await waitUntil("healing potion purchased", () =>
      bot.inventory.items().some((item) => item.name === "potion"),
    );
    if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
    bot.deactivateItem();
    await bot.waitForTicks(2);
    await rcon.command(`tp ${bot.username} 1844.5 105 2177.5`);
    await waitUntil(
      "open air for drinking",
      () => bot.entity.position.distanceTo(new Vec3(1844.5, 105, 2177.5)) < 0.6,
    );
    const potion = bot.inventory.items().find((item) => item.name === "potion");
    if (potion === undefined) throw new Error("Healing potion missing");
    await bot.moveSlotItem(potion.slot, 36);
    bot.setQuickBarSlot(0);
    await bot.waitForTicks(2);
    expect(
      await rcon.command(
        `data get entity ${bot.username} SelectedItem.components."minecraft:potion_contents"`,
      ),
    ).toContain("minecraft:healing");
    await rcon.command(`effect clear ${bot.username} minecraft:resistance`);
    await rcon.command(`damage ${bot.username} 4 minecraft:generic`);
    await waitUntil("potion healing needed", () => bot.health < 20);
    await rcon.command(
      `effect give ${bot.username} minecraft:resistance infinite 255 true`,
    );
    const beforeHealing = bot.health;
    await bot.look(0, -Math.PI / 3, true);
    const drinking = performance.now();
    await bot.consume();
    try {
      await waitUntil("native empty bottle returned", () =>
        bot.inventory.items().some((item) => item.name === "glass_bottle"),
      );
    } catch (error) {
      throw new Error(
        `Consumption inventory: ${bot.inventory
          .items()
          .map((item) => `${item.name}:${item.count.toString()}`)
          .join(
            ", ",
          )}; health ${bot.health.toString()}; ${await rcon.command(`data get entity ${bot.username} SelectedItem`)}`,
        { cause: error },
      );
    }
    expect(performance.now() - drinking).toBeGreaterThanOrEqual(650);
    expect(performance.now() - drinking).toBeLessThan(1200);
    await waitUntil("native potion healed", () => bot.health > beforeHealing);
    expect(
      bot.inventory.items().some((item) => item.name === "glass_bottle"),
    ).toBe(true);
  } finally {
    bot.deactivateItem();
    await stop(rcon);
  }
}, 60_000);

describe("Settlement relic effects on native Paper", () => {
  test("Wayfarer charges once and returns to a safe anchor", async ({
    bot,
    rcon,
  }) => {
    await start(bot, rcon);
    try {
      const sword = await grant(bot, rcon, "WAYFARER", "diamond_sword");
      await bot.equip(sword, "hand");
      await bot.waitForTicks(2);
      await bot.look(0, -Math.PI / 3, true);
      const before = bot.inventory
        .items()
        .filter((item) => item.name === "redstone")
        .reduce((sum, item) => sum + item.count, 0);
      const anchor = bot.entity.position.clone();
      bot.activateItem();
      await bot.waitForTicks(2);
      bot.deactivateItem();
      expect(
        bot.inventory
          .items()
          .filter((item) => item.name === "redstone")
          .reduce((sum, item) => sum + item.count, 0),
      ).toBe(before - 2);
      await rcon.command(`tp ${bot.username} 1847.5 105 2177.5`);
      await waitUntil("away from anchor", () => bot.entity.position.x > 1847);
      await bot.look(0, -Math.PI / 3, true);
      bot.activateItem();
      await waitUntil(
        "safe anchor return",
        () => bot.entity.position.distanceTo(anchor) < 0.6,
      );
      bot.deactivateItem();
      expect(
        bot.inventory
          .items()
          .filter((item) => item.name === "redstone")
          .reduce((sum, item) => sum + item.count, 0),
      ).toBe(before - 2);
    } finally {
      bot.deactivateItem();
      await stop(rcon);
    }
  }, 60_000);

  test("Echoheart uses accepted damage to grant and expire a native team ward", async ({
    bot,
    rcon,
  }) => {
    await start(bot, rcon);
    try {
      const chest = await grant(bot, rcon, "ECHOHEART", "diamond_chestplate");
      await bot.equip(chest, "torso");
      await bot.waitForTicks(2);
      await rcon.command(`effect clear ${bot.username} minecraft:resistance`);
      const before = bot.health;
      await rcon.command(`damage ${bot.username} 12 minecraft:generic`);
      await waitUntil("accepted health damage", () => bot.health < before);
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      await bot.waitForTicks(3);
      bot.setQuickBarSlot(8);
      await bot.waitForTicks(2);
      const ability = waitForMessage(bot, /Ability used/u);
      bot.activateItem();
      await ability;
      bot.deactivateItem();
      expect(
        await rcon.command(`data get entity ${bot.username} AbsorptionAmount`),
      ).toMatch(/: [1-6](?:\.\d+)?f$/u);
      await bot.waitForTicks(170);
      expect(
        await rcon.command(`data get entity ${bot.username} AbsorptionAmount`),
      ).toMatch(/: 0\.0f$/u);
      expect(
        await rcon.command(
          `attribute ${bot.username} minecraft:max_absorption get`,
        ),
      ).toMatch(/is 0(?:\.0)?$/u);
    } finally {
      bot.deactivateItem();
      await stop(rcon);
    }
  }, 60_000);

  test("five field salvage pickups expose their descriptions before collection", async ({
    bot,
    rcon,
  }) => {
    await start(bot, rcon);
    try {
      for (const [id, title] of [
        ["WILDGROWTH", "Wildgrowth"],
        ["REDSTONE_SURGE", "Redstone Surge"],
        ["RESONANT_SHARD", "Resonant Shard"],
        ["COPPER_PULSE", "Copper Pulse"],
        ["MASONS_ECHO", "Mason's Echo"],
      ] as const) {
        await rcon.command(`tp ${bot.username} 1844.5 105 2177.5`);
        await waitUntil("pickup approach", () => bot.entity.position.x > 1844);
        await rcon.command(`storm-fixture-survival drop ${bot.username} ${id}`);
        expect(
          await rcon.command(
            'data get entity @e[type=minecraft:text_display,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},sort=nearest,limit=1,x=1840.5,y=106,z=2177.5] text',
          ),
        ).toContain(title);
        const collected = waitForMessage(
          bot,
          new RegExp(title.replace("'", ".?"), "u"),
        );
        await rcon.command(`tp ${bot.username} 1840.5 105 2177.5`);
        await collected;
        expect(
          await rcon.command(
            'execute if entity @e[type=minecraft:item_display,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},distance=..6,x=1840.5,y=106,z=2177.5]',
          ),
        ).toContain("Test failed");
      }
    } finally {
      await stop(rcon);
    }
  }, 60_000);
});
