import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { z } from "zod";
import type { Bot } from "mineflayer";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

const Bank = z
  .object({
    emeralds: z.number().int().nonnegative(),
    iron: z.number().int().nonnegative(),
    wood: z.number().int().nonnegative(),
    stone: z.number().int().nonnegative(),
    locker: z.number().int().nonnegative(),
  })
  .strict();

async function inspect(bot: Bot, rcon: RconClient) {
  return Bank.parse(
    JSON.parse(
      await rcon.command(`storm-fixture-survival bank ${bot.username} 0`),
    ),
  );
}

async function join(bot: Bot, rcon: RconClient, debug: boolean, round = 4) {
  if (debug) await rcon.command(`op ${bot.username}`);
  const admitted = waitForMessage(bot, /Survival: Fighter/u);
  bot.chat(
    debug
      ? `/arena join settlement ${round.toString()}`
      : "/arena join settlement",
  );
  await admitted;
}

async function start(bot: Bot, rcon: RconClient, number = 4) {
  await rcon.command("difficulty normal");
  const round = waitForMessage(
    bot,
    new RegExp(`Round ${number.toString()}:`, "u"),
  );
  await rcon.command("arena start settlement");
  await round;
  await rcon.command(
    `effect give ${bot.username} minecraft:resistance infinite 255 true`,
  );
}

async function clickAt(bot: Bot, rcon: RconClient, pos: Vec3) {
  const approach = pos.offset(0.5, 0, 1.5);
  await rcon.command(
    `tp ${bot.username} ${approach.x.toString()} ${approach.y.toString()} ${approach.z.toString()}`,
  );
  await waitUntil(
    "bank fixture approach",
    () => bot.entity.position.distanceTo(approach) < 0.6,
  );
  await waitUntil("bank fixture loaded", () => bot.blockAt(pos) !== null);
  const block = bot.blockAt(pos);
  if (block === null) throw new Error("Bank fixture is missing");
  await bot.activateBlock(block);
  await waitUntil("bank or crafting window", () => bot.currentWindow !== null);
}

async function close(bot: Bot) {
  if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
}

async function runTag(bot: Bot, rcon: RconClient) {
  const data = await rcon.command(
    `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data"`,
  );
  return z.guid().parse(/[a-f0-9-]{36}/u.exec(data)?.[0]);
}

function tags(run: string, upgraded = false) {
  const upgrade = upgraded ? ',"thestorm:survival_upgrade":2' : "";
  return `PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"${upgrade}}`;
}

async function supplies(bot: Bot, rcon: RconClient, run: string) {
  for (const material of [
    "emerald",
    "iron_ingot",
    "redstone",
    "oak_planks",
    "cobblestone",
  ]) {
    await rcon.command(`clear ${bot.username} minecraft:${material}`);
  }
  for (const { material, count } of [
    { material: "emerald", count: 20 },
    { material: "iron_ingot", count: 8 },
    { material: "oak_planks", count: 8 },
    { material: "cobblestone", count: 4 },
  ]) {
    await rcon.command(
      `give ${bot.username} minecraft:${material}[minecraft:custom_data={${tags(run)}}] ${count.toString()}`,
    );
  }
}

describe("run bank on native Paper", () => {
  test("an expired box roll refunds its carried and banked emeralds exactly once", async ({
    bot,
    rcon,
  }) => {
    await join(bot, rcon, true, 15);
    try {
      await start(bot, rcon, 15);
      const run = await runTag(bot, rcon);
      await rcon.command(`clear ${bot.username} minecraft:emerald`);
      await rcon.command(
        `give ${bot.username} minecraft:emerald[minecraft:custom_data={${tags(run)}}] 12`,
      );
      await clickAt(bot, rcon, new Vec3(1760, 73, 2148));
      await bot.clickWindow(0, 0, 0);
      await close(bot);
      expect(await inspect(bot, rcon)).toMatchObject({ emeralds: 12 });
      await rcon.command(
        `give ${bot.username} minecraft:emerald[minecraft:custom_data={${tags(run)}}] 4`,
      );
      await rcon.command(`tp ${bot.username} 1793.5 73 2175.5`);
      const box = new Vec3(1793, 73, 2173);
      await waitUntil(
        "active box loaded",
        () =>
          bot.entity.position.distanceTo(new Vec3(1793.5, 73, 2175.5)) < 0.6 &&
          bot.blockAt(box) !== null,
      );
      const fixture = bot.blockAt(box);
      if (fixture === null) throw new Error("Mystery box is missing");
      const rolling = waitForMessage(bot, /Mystery box rolling/u);
      const refunded = waitForMessage(bot, /Unclaimed box.*refunded/u, 25_000);
      await bot.activateBlock(fixture);
      await rolling;
      expect(await inspect(bot, rcon)).toMatchObject({ emeralds: 0 });
      await refunded;
      await bot.waitForTicks(2);
      expect(await inspect(bot, rcon)).toMatchObject({ emeralds: 12 });
      const carried = () =>
        bot.inventory
          .items()
          .filter((item) => item.name === "emerald")
          .reduce((sum, item) => sum + item.count, 0);
      expect(carried()).toBe(4);
      await bot.waitForTicks(25);
      expect(await inspect(bot, rcon)).toMatchObject({ emeralds: 12 });
      expect(carried()).toBe(4);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 55_000);

  test("team supplies pay for another player's equipment and replaced armor stays private", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await join(bot, rcon, true);
    await join(secondBot, rcon, false);
    try {
      await start(bot, rcon);
      await rcon.command(
        `effect give ${secondBot.username} minecraft:resistance infinite 255 true`,
      );
      const run = await runTag(bot, rcon);
      await supplies(bot, rcon, run);
      for (const material of [
        "emerald",
        "iron_ingot",
        "redstone",
        "oak_planks",
        "cobblestone",
      ]) {
        await rcon.command(`clear ${secondBot.username} minecraft:${material}`);
      }
      await clickAt(bot, rcon, new Vec3(1760, 73, 2148));
      const deposited = waitForMessage(bot, /Deposited 40 supplies/u);
      await bot.clickWindow(0, 0, 0);
      await deposited;
      await close(bot);
      expect(await inspect(secondBot, rcon)).toEqual({
        emeralds: 20,
        iron: 8,
        wood: 8,
        stone: 4,
        locker: 0,
      });
      await clickAt(secondBot, rcon, new Vec3(1763, 73, 2148));
      await secondBot.clickWindow(3, 0, 0);
      await waitUntil("weapon crafted using team materials", () =>
        secondBot.inventory.items().some((i) => i.name === "stone_sword"),
      );
      expect(await inspect(bot, rcon)).toMatchObject({ wood: 6, stone: 0 });
      await close(secondBot);
      await clickAt(secondBot, rcon, new Vec3(1818, 73, 2187));
      const oldWindow = secondBot.currentWindow?.id;
      await secondBot.clickWindow(1, 0, 0);
      await waitUntil(
        "armor tab",
        () =>
          secondBot.currentWindow !== null &&
          secondBot.currentWindow.id !== oldWindow &&
          secondBot.currentWindow.slots.some(
            (item) => item?.name === "iron_helmet",
          ),
      );
      const slot = secondBot.currentWindow?.slots.findIndex(
        (i) => i?.name === "iron_helmet",
      );
      if (slot === undefined || slot < 0)
        throw new Error("Iron helmet recipe is missing");
      const crafted = waitForMessage(secondBot, /Crafted Iron helmet/u);
      await secondBot.clickWindow(slot, 0, 0);
      await crafted;
      expect(await inspect(secondBot, rcon)).toMatchObject({
        emeralds: 16,
        iron: 4,
        locker: 1,
      });
      const ownBank = await inspect(bot, rcon);
      expect(ownBank.locker).toBe(0);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 90_000);

  test("locker withdrawal preserves damage, enchantments and upgrade tags without transferring menu icons", async ({
    bot,
    rcon,
  }) => {
    await join(bot, rcon, true);
    try {
      await start(bot, rcon);
      const run = await runTag(bot, rcon);
      await rcon.command(
        `give ${bot.username} minecraft:diamond_sword[minecraft:damage=17,minecraft:enchantments={sharpness:3},minecraft:custom_data={${tags(run, true)},"thestorm-test":"preserve"}]`,
      );
      await waitUntil("tagged weapon", () =>
        bot.inventory.items().some((i) => i.name === "diamond_sword"),
      );
      const components = () =>
        rcon.command(
          `data get entity ${bot.username} Inventory[{id:"minecraft:diamond_sword"}].components`,
        );
      const before = await components();
      await clickAt(bot, rcon, new Vec3(1760, 73, 2148));
      const weapon = bot.inventory
        .items()
        .find((i) => i.name === "diamond_sword");
      const window = bot.currentWindow;
      if (weapon === undefined || window === null)
        throw new Error("Locker source missing");
      await bot.clickWindow(window.inventoryStart + weapon.slot - 9, 0, 0);
      await waitUntil(
        "weapon stored",
        () => !bot.inventory.items().some((i) => i.name === "diamond_sword"),
      );
      const depositedBank = await inspect(bot, rcon);
      expect(depositedBank.locker).toBe(1);
      const previous = bot.currentWindow?.id;
      await bot.clickWindow(1, 0, 0);
      await waitUntil(
        "private locker",
        () =>
          bot.currentWindow !== null &&
          bot.currentWindow.id !== previous &&
          bot.currentWindow.slots[0]?.name === "diamond_sword",
      );
      await bot.clickWindow(0, 0, 0);
      await waitUntil("weapon withdrawn", () =>
        bot.inventory.items().some((i) => i.name === "diamond_sword"),
      );
      expect(await components()).toBe(before);
      const withdrawnBank = await inspect(bot, rcon);
      expect(withdrawnBank.locker).toBe(0);
      expect(
        bot.inventory.items().filter((i) => i.name === "diamond_sword"),
      ).toHaveLength(1);
      expect(
        bot.inventory
          .items()
          .some((i) => i.name === "ender_chest" || i.name === "chest"),
      ).toBe(false);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 90_000);
});
