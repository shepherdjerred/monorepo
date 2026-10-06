import { describe, expect } from "vitest";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { test } from "#e2e/arena-fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { eventually } from "#e2e/harness/rwf-match.ts";
import { startSettlementRound as practice } from "#e2e/harness/settlement.ts";

async function stand(bot: Bot, rcon: RconClient, at: Vec3) {
  await rcon.command(
    `minecraft:tp ${bot.username} ${at.x.toString()} ${at.y.toString()} ${at.z.toString()}`,
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

const WindLanesSchema = z.object({
  shape: z.literal("WIND_LANES"),
  origin: z.tuple([z.number(), z.number(), z.number()]),
  aim: z.tuple([z.number(), z.number(), z.number()]),
});

const BossPresenceSchema = z
  .enum(["Test passed. Count: 1", "Test failed"])
  .transform((result) => result === "Test passed. Count: 1");

/** Stand in the gap between lanes, perpendicular to the cast's locked direction. */
function dodgeWindLanes(cast: z.infer<typeof WindLanesSchema>): Vec3 {
  const dx = cast.aim[0] - cast.origin[0];
  const dz = cast.aim[2] - cast.origin[2];
  const length = Math.hypot(dx, dz);
  // BossMechanics uses positive X when origin and aim coincide.
  const ux = length < 0.01 ? 1 : dx / length;
  const uz = length < 0.01 ? 0 : dz / length;
  return new Vec3(cast.aim[0] - 3 * uz, cast.aim[1], cast.aim[2] + 3 * ux);
}

async function prepareBoss(bot: Bot, rcon: RconClient, bossAt: Vec3) {
  await practice(bot, rcon, 5);
  await rcon.command(`storm-fixture-survival hungry ${bot.username} none`);
  await rcon.command(`storm-fixture-survival terrain ${bot.username} none`);
  await stand(bot, rcon, new Vec3(23.5, 105, -40.5));
  const boss =
    '@e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1]';
  await eventually(
    "native boss spawned",
    async () =>
      BossPresenceSchema.parse(await rcon.command(`execute if entity ${boss}`)),
    10_000,
  );
  await rcon.command(
    `minecraft:tp ${boss} ${bossAt.x.toString()} ${bossAt.y.toString()} ${bossAt.z.toString()}`,
  );
  await rcon.command(`data merge entity ${boss} {NoAI:1b}`);
  // Escorts must not obscure the damage caused by the locked boss cast.
  await rcon.command(
    'execute as @e[type=!minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}] run attribute @s minecraft:attack_damage base set 0',
  );
  await waitUntil("boss tracked by the client", () =>
    Object.values(bot.entities).some((entity) => entity.name === "breeze"),
  );
  for (const slot of ["head", "chest", "legs", "feet", "offhand"])
    await rcon.command(
      `item replace entity ${bot.username} ${slot === "offhand" ? "weapon.offhand" : `armor.${slot}`} with minecraft:air`,
    );
}

describe("Settlement iteration on native Paper", () => {
  test("shop divider protects icons while inventory rearrangement remains available", async ({
    bot,
    rcon,
  }) => {
    try {
      await practice(bot, rcon, 8);
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      await stand(bot, rcon, new Vec3(-26.5, 73, 54.5));
      await waitUntil(
        "workbench loaded",
        () => bot.blockAt(new Vec3(-27, 73, 52)) !== null,
      );
      const block = bot.blockAt(new Vec3(-27, 73, 52));
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
    try {
      await practice(bot, rcon, 8);
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      await stand(bot, rcon, new Vec3(23.5, 105, -40.5));
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
      // Keep the native target's hitbox aligned with this fixed throw aim.
      await rcon.command(
        `data merge entity ${selector} {Health:1.0f,IsBaby:0b}`,
      );
      await waitUntil("trident target", () =>
        Object.values(bot.entities).some(
          (entity) =>
            entity.name === "zombie" &&
            entity.position.distanceTo(new Vec3(19.5, 105, -40.5)) < 1,
        ),
      );
      const target = Object.values(bot.entities).find(
        (entity) =>
          entity.name === "zombie" &&
          entity.position.distanceTo(new Vec3(19.5, 105, -40.5)) < 1,
      );
      if (target === undefined) throw new Error("Trident target missing");
      const emeralds = bot.inventory
        .items()
        .filter((item) => item.name === "emerald")
        .reduce((total, item) => total + item.count, 0);
      await bot.lookAt(target.position.offset(0, 1.4, 0));
      bot.activateItem();
      // Observe twenty client physics ticks while charging before releasing.
      await bot.waitForTicks(20);
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
          emeralds + 1,
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
      const messages: string[] = [];
      const observe = (message: string) => {
        messages.push(message);
      };
      bot.on("messagestr", observe);
      try {
        const bossAt = dodge
          ? new Vec3(23.5, 105, -44.5)
          : new Vec3(19.5, 105, -40.5);
        // Subscribe before starting the round: setup can overlap the first cast.
        await Promise.all([
          waitForMessage(bot, /Breeze Sovereign casts Wind lanes/u, 15_000),
          prepareBoss(bot, rcon, bossAt),
        ]);
        // Round five drafts zombies and husks; isolate both escort types from
        // the cast assertion without changing the boss's scripted damage.
        await rcon.command(
          'execute as @e[type=!minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}] run data merge entity @s {NoAI:1b}',
        );
        const cast = WindLanesSchema.parse(
          JSON.parse(
            await rcon.command(
              `storm-fixture-survival cast ${bot.username} none`,
            ),
          ),
        );
        expect(new Vec3(...cast.origin).distanceTo(bossAt)).toBeLessThan(0.01);
        await stand(bot, rcon, new Vec3(...cast.aim));
        if (dodge) await stand(bot, rcon, dodgeWindLanes(cast));
        const before = bot.health;
        await waitForMessage(bot, /recovery: attack now/u, 6000);
        await Bun.sleep(150);
        expect(
          messages.some((message) => message.includes("Hit by Wind lanes.")),
        ).toBe(!dodge);
        const evidence = JSON.stringify({
          cast,
          at: bot.entity.position,
          messages,
        });
        if (dodge) expect(bot.health, evidence).toBe(before);
        else expect(bot.health, evidence).toBeLessThan(before);
      } finally {
        bot.off("messagestr", observe);
        await stop(rcon);
      }
    }, 60_000);
});
