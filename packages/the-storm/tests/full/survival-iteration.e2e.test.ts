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

const WindCastSchema = z.object({
  shape: z.literal("WIND_LANES"),
  origin: z.tuple([z.number(), z.number(), z.number()]),
  aim: z.tuple([z.number(), z.number(), z.number()]),
});

const BossPresenceSchema = z
  .enum(["Test passed. Count: 1", "Test failed"])
  .transform((result) => result === "Test passed. Count: 1");

async function removeArmor(rcon: RconClient, username: string): Promise<void> {
  for (const slot of ["head", "chest", "legs", "feet", "offhand"])
    await rcon.command(
      `item replace entity ${username} ${slot === "offhand" ? "weapon.offhand" : `armor.${slot}`} with minecraft:air`,
    );
}

async function currentWindCast(rcon: RconClient, username: string) {
  return WindCastSchema.parse(
    JSON.parse(
      await rcon.command(`storm-fixture-survival cast ${username} none`),
    ),
  );
}

async function prepareWindCast(bot: Bot, rcon: RconClient): Promise<void> {
  const boss =
    '@e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1]';
  // Spawn points can be outside this client's tracking range. Prove the
  // native spawn before bringing the boss into the test's cast position.
  await eventually(
    "boss spawned on the server",
    async () =>
      BossPresenceSchema.parse(await rcon.command(`execute if entity ${boss}`)),
    10_000,
  );
  const casting = waitForMessage(
    bot,
    /Breeze Sovereign casts Wind lanes/u,
    15_000,
  );
  await rcon.command(`tp ${boss} -4.5 73 53.5`);
  await rcon.command(`data merge entity ${boss} {NoAI:1b}`);
  await waitUntil("boss tracked by the client", () =>
    Object.values(bot.entities).some((entity) => entity.name === "breeze"),
  );
  await removeArmor(rcon, bot.username);
  await casting;
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
    await practice(bot, rcon, 8);
    try {
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
      await rcon.command(
        `data modify entity ${selector} Health set value 1.0f`,
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
        await stand(bot, rcon, new Vec3(-1.5, 73, 53.5));
        await prepareWindCast(bot, rcon);
        await rcon.command(
          'execute as @e[type=minecraft:zombie,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}] run data merge entity @s {NoAI:1b}',
        );
        const cast = await currentWindCast(rcon, bot.username);
        await stand(bot, rcon, new Vec3(...cast.aim));
        if (dodge) {
          const dx = cast.aim[0] - cast.origin[0];
          const dz = cast.aim[2] - cast.origin[2];
          const length = Math.hypot(dx, dz);
          if (length < 0.01) throw new Error("Wind lane has no direction");
          // Wind lanes occupy offsets 0 and ±6 from the aim line; step beyond
          // the outer lane along its perpendicular, independent of cast angle.
          await stand(
            bot,
            rcon,
            new Vec3(
              cast.aim[0] + (dz / length) * 9,
              cast.aim[1],
              cast.aim[2] - (dx / length) * 9,
            ),
          );
        }
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
