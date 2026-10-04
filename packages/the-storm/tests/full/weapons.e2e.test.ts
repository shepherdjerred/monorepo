import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { z } from "zod";
import type { Bot } from "mineflayer";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

const boss =
  '@e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1]';

async function begin(bot: Bot, rcon: RconClient, round: number) {
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

async function health(rcon: RconClient, selector: string) {
  const data = await rcon.command(`data get entity ${selector} Health`);
  return z.coerce.number().parse(/: ([\d.]+)f/u.exec(data)?.[1]);
}

async function weapon(
  bot: Bot,
  rcon: RconClient,
  id: string,
  material: string,
) {
  expect(
    await rcon.command(
      `storm-fixture-survival legendary ${bot.username} ${id}`,
    ),
  ).toContain(id);
  await waitUntil("signature weapon delivered", () =>
    bot.inventory.items().some((item) => item.name === material),
  );
  const item = bot.inventory
    .items()
    .find((candidate) => candidate.name === material);
  if (item === undefined) throw new Error("Signature weapon is missing");
  await bot.equip(item, "hand");
}

function arrows(bot: Bot) {
  return bot.inventory
    .items()
    .filter((item) => item.name === "arrow")
    .reduce((sum, item) => sum + item.count, 0);
}

describe("signature weapons and boss phases on native Paper", () => {
  test("a burst cannot skip the Breeze's vortex and barrage phases", async ({
    bot,
    rcon,
  }) => {
    await begin(bot, rcon, 5);
    try {
      const lanes = waitForMessage(bot, /casts Wind lanes.*Phase 1/u, 15_000);
      await rcon.command(
        `damage ${boss} 999 minecraft:player_attack by ${bot.username}`,
      );
      expect(await health(rcon, boss)).toBeCloseTo(132);
      await rcon.command(
        `damage ${boss} 999 minecraft:player_attack by ${bot.username}`,
      );
      expect(await health(rcon, boss)).toBeCloseTo(132);
      await lanes;
      const vortex = waitForMessage(bot, /casts Vortex.*Phase 2/u, 15_000);
      await vortex;
      await rcon.command(
        `damage ${boss} 999 minecraft:player_attack by ${bot.username}`,
      );
      expect(await health(rcon, boss)).toBeCloseTo(66);
      const barrage = waitForMessage(
        bot,
        /casts Wind barrage.*Phase 3/u,
        15_000,
      );
      await barrage;
      await rcon.command(
        `damage ${boss} 999 minecraft:player_attack by ${bot.username}`,
      );
      expect(await health(rcon, boss)).toBeCloseTo(1);
      await rcon.command(
        `damage ${boss} 999 minecraft:player_attack by ${bot.username}`,
      );
      expect(await health(rcon, boss)).toBeCloseTo(1);
      await Bun.sleep(4500);
      await rcon.command(
        `damage ${boss} 999 minecraft:player_attack by ${bot.username}`,
      );
      await bot.waitForTicks(25);
      expect(await rcon.command(`data get entity ${boss} Health`)).toContain(
        "No entity",
      );
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 60_000);

  test("Repeater consumes carried arrows at four shots per second and release adds no vanilla shot", async ({
    bot,
    rcon,
  }) => {
    await begin(bot, rcon, 15);
    try {
      const data = await rcon.command(
        `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data"`,
      );
      const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(data)?.[0]);
      await rcon.command(`clear ${bot.username} minecraft:arrow`);
      await rcon.command(
        `give ${bot.username} minecraft:arrow[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] 32`,
      );
      await weapon(bot, rcon, "REPEATER", "bow");
      await rcon.command(`tp ${bot.username} 1806.5 85 2272.5`);
      await waitUntil("bow ammunition", () => arrows(bot) === 32);
      await bot.look(0, 0, true);
      bot.activateItem();
      await bot.waitForTicks(21);
      bot.deactivateItem();
      await bot.waitForTicks(2);
      const spent = 32 - arrows(bot);
      expect(spent).toBeGreaterThanOrEqual(4);
      expect(spent).toBeLessThanOrEqual(5);
      await bot.waitForTicks(12);
      expect(arrows(bot)).toBe(32 - spent);
      bot.activateItem();
      await bot.waitForTicks(7);
      const sword = bot.inventory
        .items()
        .find((item) => item.name === "iron_sword");
      if (sword === undefined) throw new Error("Debug sword is missing");
      await bot.equip(sword, "hand");
      await bot.waitForTicks(2);
      const switched = arrows(bot);
      await bot.waitForTicks(12);
      expect(arrows(bot)).toBe(switched);
    } finally {
      bot.deactivateItem();
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 40_000);

  test("Whirlwind cleaves once per recovery", async ({ bot, rcon }) => {
    await begin(bot, rcon, 15);
    try {
      await rcon.command(`tp ${bot.username} 1806.5 85 2272.5`);
      await waitUntil(
        "combat terrace",
        () =>
          bot.entity.position.distanceTo(new Vec3(1806.5, 85, 2272.5)) < 0.6,
      );
      await rcon.command(`storm-fixture-survival targets ${bot.username} none`);
      await weapon(bot, rcon, "WHIRLWIND", "iron_axe");
      const primary =
        '@e[type=minecraft:zombie,name="Legendary target 1",limit=1]';
      const secondary =
        '@e[type=minecraft:zombie,name="Legendary target 0",limit=1]';
      for (const slot of ["head", "chest", "legs", "feet"]) {
        await rcon.command(
          `item replace entity ${secondary} armor.${slot} with minecraft:air`,
        );
      }
      await rcon.command(`attribute ${secondary} minecraft:armor base set 0`);
      await rcon.command(
        `attribute ${secondary} minecraft:armor_toughness base set 0`,
      );
      await rcon.command(
        `damage ${primary} 1 minecraft:player_attack by ${bot.username}`,
      );
      const after = await health(rcon, secondary);
      expect(after).toBeCloseTo(96);
      await bot.waitForTicks(12);
      await rcon.command(
        `damage ${primary} 1 minecraft:player_attack by ${bot.username}`,
      );
      expect(await health(rcon, secondary)).toBe(after);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 40_000);

  test("Riftblade cannot dash through a locked gate", async ({ bot, rcon }) => {
    await begin(bot, rcon, 1);
    try {
      await weapon(bot, rcon, "RIFTBLADE", "diamond_sword");
      const approach = new Vec3(1808.5, 73, 2156.5);
      await rcon.command(`tp ${bot.username} 1808.5 73 2156.5`);
      await waitUntil(
        "closed quarry approach",
        () => bot.entity.position.distanceTo(approach) < 0.6,
      );
      await bot.lookAt(new Vec3(1814.5, 74.6, 2156.5));
      bot.activateItem();
      await bot.waitForTicks(5);
      expect(bot.entity.position.x).toBeLessThan(1810);
      expect(bot.entity.position.distanceTo(approach)).toBeLessThan(4.5);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 40_000);
});
