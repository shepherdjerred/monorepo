import { expect } from "vitest";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

async function start(bot: Bot, rcon: RconClient, round: number) {
  await rcon.command(`op ${bot.username}`);
  const joined = waitForMessage(bot, /Survival: Fighter/u);
  bot.chat(`/arena join settlement ${round.toString()}`);
  await joined;
  await rcon.command("difficulty normal");
  const started = waitForMessage(
    bot,
    new RegExp(`Round ${round.toString()}:`, "u"),
  );
  await rcon.command("arena start settlement");
  await started;
  await rcon.command(
    `effect give ${bot.username} minecraft:resistance infinite 255 true`,
  );
}

async function click(bot: Bot, rcon: RconClient, pos: Vec3) {
  const approach = new Vec3(pos.x + 0.5, 73, pos.z + 1.5);
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
    await click(bot, rcon, new Vec3(1763, 73, 2148));
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
    await rcon.command(`tp ${bot.username} 1757.5 81 2242.5`);
    await waitUntil(
      "airstrip loaded",
      () => bot.blockAt(new Vec3(1756, 81, 2241)) !== null,
    );
    const airstrip = bot.blockAt(new Vec3(1756, 81, 2241));
    if (airstrip === null) throw new Error("Airstrip missing");
    const landed = waitForMessage(bot, /Offshore Runeforge/u, 15_000);
    await bot.activateBlock(airstrip);
    await landed;
    await click(bot, rcon, new Vec3(1727, 73, 2209));
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
        "execute if block 1834 73 2189 minecraft:waxed_copper_block",
      ),
    ).toBe("Test passed");
    expect(
      await rcon.command("execute if block 1834 74 2189 minecraft:lodestone"),
    ).toBe("Test passed");
    await click(bot, rcon, new Vec3(1834, 74, 2189));
    for (const [x, positionZ, name] of [
      [1765, 2185, "Stoneward"],
      [1787, 2163, "Galestride"],
    ] as const) {
      await click(bot, rcon, new Vec3(x, 74, positionZ));
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
    await click(bot, rcon, new Vec3(1829, 74, 2187));
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
    await click(bot, rcon, new Vec3(1829, 74, 2187));
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
    await click(bot, rcon, new Vec3(1765, 74, 2185));
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
    await rcon.command(`tp ${bot.username} 1806.5 85 2272.5`);
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
