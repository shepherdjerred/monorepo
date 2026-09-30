import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { waitUntil } from "./harness/bot.ts";

const bridgeDeck = [1, 2, 3].map((z) => new Vec3(0, -54, z));
const piston = new Vec3(8, -45, 0);
const pushDestinations = [new Vec3(14, -45, 0), new Vec3(15, -45, 0)];

function material(bot: Bot, at: Vec3) {
  return bot.blockAt(at)?.name ?? "air";
}

describe("The Storm mechanics on Paper", () => {
  test("preserves bridge blocks and drops its stored stock when the keeper sign breaks", async ({
    bot,
    rcon,
  }) => {
    const planks = bot.registry.itemsByName["oak_planks"];
    if (planks === undefined) {
      throw new Error("minecraft-data has no oak planks item");
    }
    await rcon.command(`tp ${bot.username} 0 -53 1`);
    await waitUntil(
      "bridge keeper sign to load",
      () => bot.blockAt(new Vec3(0, -55, 0)) !== null,
    );
    const keeper = bot.blockAt(new Vec3(0, -55, 0));
    expect(keeper?.name).toBe("oak_wall_sign");

    await bot.activateBlock(keeper!);
    await waitUntil("bridge blocks to move into keeper stock", () =>
      bridgeDeck.every((at) => material(bot, at) === "air"),
    );

    await Bun.sleep(1200);
    await bot.activateBlock(keeper!);
    await waitUntil("bridge blocks to return from keeper stock", () =>
      bridgeDeck.every((at) => material(bot, at) === "oak_planks"),
    );

    await Bun.sleep(1200);
    await bot.activateBlock(keeper!);
    await waitUntil("bridge blocks to be stored before keeper sign break", () =>
      bridgeDeck.every((at) => material(bot, at) === "air"),
    );
    await rcon.command(`tp ${bot.username} 0 -53 1`);
    await bot.dig(keeper!);
    let keeperBroken = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      keeperBroken =
        (await rcon.command("execute if block 0 -55 0 minecraft:air")) ===
        "Test passed";
      if (keeperBroken) {
        break;
      }
      await Bun.sleep(50);
    }
    expect(keeperBroken).toBe(true);
    await waitUntil(
      "keeper sign to break",
      () => material(bot, new Vec3(0, -55, 0)) === "air",
    );
    let delivered = false;
    let droppedStock = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      const inventoryCount = bot.inventory.count(planks.id, null);
      if (inventoryCount === 3) {
        delivered = true;
        break;
      }
      droppedStock = await rcon.command(
        'execute positioned 0 -55 0 run data get entity @e[type=minecraft:item,nbt={Item:{id:"minecraft:oak_planks"}},distance=..6,sort=nearest,limit=1] Item',
      );
      delivered =
        droppedStock.includes('"minecraft:oak_planks"') &&
        droppedStock.includes("count: 3");
      if (delivered) {
        break;
      }
      await Bun.sleep(50);
    }
    expect(
      delivered,
      `expected 3 planks in bot inventory or dropped nearby: ${droppedStock}`,
    ).toBe(true);
  });

  test("super-push moves the vanilla piston load the configured extra distance", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`tp ${bot.username} 8 -43 0`);
    await waitUntil("piston to load", () => bot.blockAt(piston) !== null);
    expect(material(bot, piston)).toBe("piston");
    await rcon.command("setblock 8 -45 1 minecraft:redstone_block");
    await waitUntil(
      "super-push load to travel four extra blocks after vanilla extension",
      () => pushDestinations.every((at) => material(bot, at) === "stone"),
      10_000,
    );
  });
});
