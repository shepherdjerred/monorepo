import { expect } from "vitest";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { test } from "#e2e/arena-fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import {
  startProtectedSettlementRound as start,
  travelToRuneforge,
} from "#e2e/harness/settlement.ts";

async function click(bot: Bot, rcon: RconClient, pos: Vec3) {
  const approach = new Vec3(pos.x + 0.5, pos.y, pos.z + 1.5);
  const moved = new Promise<void>((resolve) => bot.once("forcedMove", resolve));
  await rcon.command(
    `tp ${bot.username} ${approach.x.toString()} ${approach.y.toString()} ${approach.z.toString()}`,
  );
  await moved;
  await waitUntil(
    "fixture approach",
    () =>
      bot.entity.position.distanceTo(approach) < 0.6 &&
      bot.blockAt(pos) !== null,
  );
  const block = bot.blockAt(pos);
  if (block === null) throw new Error("Fixture missing");
  await bot.activateBlock(block);
}

async function close(bot: Bot) {
  if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
  await bot.waitForTicks(2);
}

async function stop(rcon: RconClient) {
  await rcon.command("arena stop settlement");
  await rcon.command("difficulty peaceful");
}

async function runSupply(
  bot: Bot,
  rcon: RconClient,
  material: string,
  count: number,
) {
  const data = await rcon.command(
    `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
  );
  const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(data)?.[0]);
  await rcon.command(
    `give ${bot.username} minecraft:${material}[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] ${count.toString()}`,
  );
}

async function upgradeMessage(bot: Bot, rcon: RconClient) {
  try {
    return await waitForMessage(bot, /Runeforge augmentation/u);
  } catch (error) {
    throw new Error(
      `Forge at ${bot.entity.position.toString()}, selected ${String(bot.heldItem?.name)}, window ${String(bot.currentWindow?.title)}: ${await rcon.command(`storm-fixture-survival inspect ${bot.username} none`)}: ${String(error)}`,
      { cause: error },
    );
  }
}

test("station repair keeps an off-hand shield and its metadata in the same slot", async ({
  bot,
  rcon,
}) => {
  await start(bot, rcon, 15);
  try {
    bot.setQuickBarSlot(0);
    await bot.waitForTicks(2);
    const data = await rcon.command(
      `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
    );
    const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(data)?.[0]);
    const supplied = await rcon.command(
      `item replace entity ${bot.username} weapon.offhand with minecraft:shield[minecraft:damage=85,minecraft:enchantments={unbreaking:3},minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}","thestorm:survival_upgrade":0,"thestorm:survival_rarity":"COMMON","thestorm:survival_equipment_id":"1b91bfc2-2697-4c35-b393-715273491bad"},"thestorm-test":"offhand-repair"}]`,
    );
    expect(supplied).toContain("Replaced");
    await runSupply(bot, rcon, "iron_ingot", 2);
    await runSupply(bot, rcon, "emerald", 2);
    await bot.waitForTicks(3);
    const supplies = (name: string) =>
      bot.inventory
        .items()
        .filter((item) => item.name === name)
        .reduce((sum, item) => sum + item.count, 0);
    const iron = supplies("iron_ingot");
    const emeralds = supplies("emerald");
    const main = await rcon.command(
      `data get entity ${bot.username} SelectedItem`,
    );
    const shieldMetadata = await rcon.command(
      `data get entity ${bot.username} equipment.offhand.components."minecraft:custom_data"`,
    );
    const enchantments = await rcon.command(
      `data get entity ${bot.username} equipment.offhand.components."minecraft:enchantments"`,
    );
    expect(
      await rcon.command(
        `data get entity ${bot.username} equipment.offhand.components."minecraft:damage"`,
      ),
    ).toMatch(/: 85$/u);
    await click(bot, rcon, new Vec3(-27, 73, 52));
    try {
      await waitUntil("repair menu", () => bot.currentWindow !== null);
    } catch (error) {
      throw new Error(
        `Repair at ${bot.entity.position.toString()}, selected ${String(bot.heldItem?.name)}, main ${main}: ${String(error)}`,
        { cause: error },
      );
    }
    await bot.clickWindow(45, 0, 0);
    await close(bot);
    expect(
      await rcon.command(
        `execute if items entity ${bot.username} weapon.offhand minecraft:shield[minecraft:damage=0] run data get entity ${bot.username} equipment.offhand.id`,
      ),
    ).toContain("minecraft:shield");
    expect(
      await rcon.command(`data get entity ${bot.username} SelectedItem`),
    ).toBe(main);
    expect(
      await rcon.command(
        `data get entity ${bot.username} equipment.offhand.components."minecraft:custom_data"`,
      ),
    ).toBe(shieldMetadata);
    expect(
      await rcon.command(
        `data get entity ${bot.username} equipment.offhand.components."minecraft:enchantments"`,
      ),
    ).toBe(enchantments);
    await waitUntil(
      "single repair payment",
      () =>
        supplies("iron_ingot") === iron - 2 &&
        supplies("emerald") === emeralds - 2,
    );
    expect(supplies("iron_ingot")).toBe(iron - 2);
    expect(supplies("emerald")).toBe(emeralds - 2);
  } finally {
    await stop(rcon);
  }
});

test("all fourteen signatures carry the correct rarity and equipment identity", async ({
  bot,
  rcon,
}) => {
  await start(bot, rcon, 15);
  try {
    for (const id of [
      "STORMCALLER",
      "FROSTBITE",
      "GRAVITON",
      "REPEATER",
      "WHIRLWIND",
      "TIDEBREAKER",
      "RIFTBLADE",
      "COPPERGUARD",
      "BRIARPLATE",
      "TRAILWARDEN",
      "STORMGLASS",
      "WAYFARER",
      "ECHOHEART",
      "FAULTLINE",
    ]) {
      // Each identity is an independent fixture; clear the previous equipment
      // so this metadata test does not ask production to bypass the carry limit.
      await rcon.command(`clear ${bot.username}`);
      await bot.waitForTicks(2);
      const occupied = new Set(bot.inventory.items().map((item) => item.slot));
      await rcon.command(
        `storm-fixture-survival legendary ${bot.username} ${id}`,
      );
      await waitUntil("signature delivered", () =>
        bot.inventory.items().some((item) => !occupied.has(item.slot)),
      );
      const item = bot.inventory
        .items()
        .find((candidate) => !occupied.has(candidate.slot));
      if (item === undefined) throw new Error("Signature missing");
      await bot.moveSlotItem(item.slot, 36);
      bot.setQuickBarSlot(0);
      await bot.waitForTicks(2);
      const metadata = await rcon.command(
        `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_legendary"`,
      );
      expect(metadata).toContain(id);
      expect(
        await rcon.command(
          `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_rarity"`,
        ),
      ).toContain(
        ["STORMGLASS", "WAYFARER", "ECHOHEART", "FAULTLINE"].includes(id)
          ? "MYTHIC"
          : "LEGENDARY",
      );
      expect(
        await rcon.command(
          `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_equipment_id"`,
        ),
      ).toMatch(/[a-f0-9-]{36}/u);
      expect(
        await rcon.command(
          `data get entity ${bot.username} SelectedItem.components."minecraft:lore"`,
        ),
      ).toContain("Rarity:");
    }
  } finally {
    await stop(rcon);
  }
}, 90_000);

test("enchanting and Runeforge preserve independent rarity, armor and shield signatures", async ({
  bot,
  rcon,
}) => {
  await start(bot, rcon, 15);
  try {
    bot.setQuickBarSlot(0);
    await runSupply(bot, rcon, "glowstone_dust", 12);
    const initial = await rcon.command(
      `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data"`,
    );
    expect(initial).toContain("COMMON");
    await click(bot, rcon, new Vec3(-27, 73, 52));
    await waitUntil("enchanting menu", () => bot.currentWindow !== null);
    await bot.clickWindow(46, 0, 0);
    await bot.waitForTicks(3);
    expect(
      await rcon.command(
        `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data"`,
      ),
    ).toContain("UNCOMMON");
    await bot.clickWindow(46, 0, 0);
    await bot.waitForTicks(3);
    expect(
      await rcon.command(
        `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data"`,
      ),
    ).toContain("EPIC");
    await close(bot);
    await rcon.command(
      `storm-fixture-survival legendary ${bot.username} ECHOHEART`,
    );
    await rcon.command(
      `storm-fixture-survival legendary ${bot.username} FAULTLINE`,
    );
    await waitUntil(
      "armor and shield delivered",
      () =>
        bot.inventory
          .items()
          .some((item) => item.name === "diamond_chestplate") &&
        bot.inventory.items().some((item) => item.name === "shield"),
    );
    const chest = bot.inventory
      .items()
      .find((item) => item.name === "diamond_chestplate");
    const shield = bot.inventory.items().find((item) => item.name === "shield");
    if (chest === undefined || shield === undefined)
      throw new Error("Armor fixture missing");
    await bot.equip(chest, "torso");
    await bot.equip(shield, "off-hand");
    await travelToRuneforge(bot, rcon);
    await click(bot, rcon, new Vec3(-65, 73, 1));
    await waitUntil("equipment selection", () => bot.currentWindow !== null);
    for (const slot of [0, 1, 3]) {
      const previous = bot.currentWindow?.id;
      const upgraded = upgradeMessage(bot, rcon);
      await bot.clickWindow(slot, 0, 0);
      await upgraded;
      await waitUntil(
        "refreshed equipment choices",
        () => bot.currentWindow !== null && bot.currentWindow.id !== previous,
      );
    }
    await close(bot);
    for (const [path, rarity, signature] of [
      ["SelectedItem", "EPIC", null],
      ["equipment.chest", "MYTHIC", "ECHOHEART"],
      ["equipment.offhand", "MYTHIC", "FAULTLINE"],
    ] as const) {
      const metadata = await rcon.command(
        `data get entity ${bot.username} ${path}.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_rarity"`,
      );
      expect(metadata).toContain(rarity);
      if (signature !== null)
        expect(
          await rcon.command(
            `data get entity ${bot.username} ${path}.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_legendary"`,
          ),
        ).toContain(signature);
      expect(
        await rcon.command(
          `data get entity ${bot.username} ${path}.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_upgrade"`,
        ),
      ).toMatch(/: [123]$/u);
    }
  } finally {
    await stop(rcon);
  }
}, 90_000);

test("vertical shrines play local music and require an explicit third-boon replacement", async ({
  bot,
  rcon,
}) => {
  await start(bot, rcon, 8);
  const heard: string[] = [];
  const stopped: string[] = [];
  const hear = (sound: string) => {
    heard.push(sound);
  };
  const silence = (packet: unknown) => {
    stopped.push(JSON.stringify(packet));
  };
  bot.on("soundEffectHeard", hear);
  bot._client.on("stop_sound", silence);
  try {
    expect(
      await rcon.command(
        "execute if block 58 89 2 minecraft:waxed_copper_block",
      ),
    ).toBe("Test passed");
    expect(
      await rcon.command("execute if block 58 90 2 minecraft:lodestone"),
    ).toBe("Test passed");
    await click(bot, rcon, new Vec3(58, 90, 2));
    for (const [x, height, positionZ, name] of [
      [-28, 90, -19, "Stoneward"],
      [21, 90, 23, "Galestride"],
    ] as const) {
      await click(bot, rcon, new Vec3(x, height, positionZ));
      await waitUntil("boon menu", () => bot.currentWindow !== null);
      const equipped = waitForMessage(bot, new RegExp(`Equipped ${name}`, "u"));
      await bot.clickWindow(0, 0, 0);
      await equipped;
      await close(bot);
    }
    try {
      await waitUntil("native shrine record", () =>
        heard.some((packet) => packet.includes("music_disc.otherside")),
      );
    } catch (error) {
      throw new Error(`${String(error)}; heard ${heard.join(", ")}`, {
        cause: error,
      });
    }
    await click(bot, rcon, new Vec3(6, 106, -45));
    await waitUntil(
      "replacement choices",
      () => bot.currentWindow?.slots[1]?.name === "amethyst_shard",
    );
    const before = bot.inventory
      .items()
      .filter((item) => item.name === "emerald")
      .reduce((sum, item) => sum + item.count, 0);
    await close(bot);
    expect(
      bot.inventory
        .items()
        .filter((item) => item.name === "emerald")
        .reduce((sum, item) => sum + item.count, 0),
    ).toBe(before);
    await click(bot, rcon, new Vec3(6, 106, -45));
    await waitUntil(
      "replacement menu reopened",
      () => bot.currentWindow !== null,
    );
    const replaced = waitForMessage(bot, /Equipped Emberweave/u);
    await bot.clickWindow(0, 0, 0);
    await replaced;
    await close(bot);
    await waitUntil(
      "replacement payment reached inventory",
      () =>
        bot.inventory
          .items()
          .filter((item) => item.name === "emerald")
          .reduce((sum, item) => sum + item.count, 0) ===
        before - 32,
    );
    expect(
      bot.inventory
        .items()
        .filter((item) => item.name === "emerald")
        .reduce((sum, item) => sum + item.count, 0),
    ).toBe(before - 32);
    await click(bot, rcon, new Vec3(-28, 90, -19));
    await waitUntil(
      "owned boon menu reopened",
      () => bot.currentWindow !== null,
    );
    const swapped = waitForMessage(bot, /Equipped Stoneward/u);
    await bot.clickWindow(0, 0, 0);
    await swapped;
    await close(bot);
    expect(
      bot.inventory
        .items()
        .filter((item) => item.name === "emerald")
        .reduce((sum, item) => sum + item.count, 0),
    ).toBe(before - 32);
    await rcon.command(`tp ${bot.username} 52.5 105 -30.5`);
    await waitUntil(
      "record stopped outside shrine radius",
      () => stopped.length > 0,
    );
  } finally {
    bot.off("soundEffectHeard", hear);
    bot._client.off("stop_sound", silence);
    await stop(rcon);
  }
}, 90_000);
