import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { z } from "zod";
import type { Bot } from "mineflayer";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { startProtectedSettlementRound as begin } from "#e2e/harness/settlement.ts";

const boss =
  '@e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1]';

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

const RepeaterStopSchema = z.strictObject({
  tick: z.number().int(),
  arrows: z.number().int().nonnegative(),
  shots: z.number().int().nonnegative(),
});
const RepeaterObservationSchema = z.strictObject({
  initialArrows: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  tick: z.number().int(),
  arrows: z.number().int().nonnegative(),
  handRaised: z.boolean(),
  shots: z.array(
    z.strictObject({
      elapsedMs: z.number().nonnegative(),
      tick: z.number().int(),
      arrows: z.number().int().nonnegative(),
    }),
  ),
  release: RepeaterStopSchema.nullable(),
  switched: RepeaterStopSchema.nullable(),
});

async function repeaterObservation(
  bot: Bot,
  rcon: RconClient,
  action = "read",
) {
  return RepeaterObservationSchema.parse(
    JSON.parse(
      await rcon.command(`storm-fixture-repeater ${action} ${bot.username}`),
    ),
  );
}

async function observeRepeater(
  bot: Bot,
  rcon: RconClient,
  description: string,
  ready: (value: z.infer<typeof RepeaterObservationSchema>) => boolean,
) {
  const deadline = performance.now() + 10_000;
  while (true) {
    const observation = await repeaterObservation(bot, rcon);
    if (ready(observation)) return observation;
    if (performance.now() > deadline)
      throw new Error(`Timed out waiting for ${description}`);
    await Bun.sleep(50);
  }
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
        `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
      );
      const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(data)?.[0]);
      await rcon.command(`clear ${bot.username} minecraft:arrow`);
      await rcon.command(
        `give ${bot.username} minecraft:arrow[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] 32`,
      );
      await weapon(bot, rcon, "REPEATER", "bow");
      await rcon.command(`tp ${bot.username} 1844.5 105 2177.5`);
      await waitUntil("bow ammunition", () => arrows(bot) === 32);
      await bot.look(0, 0, true);
      const initial = await repeaterObservation(bot, rcon, "start");
      expect(initial.initialArrows).toBe(32);
      bot.activateItem();
      // Mineflayer's physics ticks are a local clock. Observe actual server
      // launches for one monotonic second from the acknowledged first shot.
      const firing = await observeRepeater(
        bot,
        rcon,
        "one server-observed second of Repeater fire",
        (value) => value.shots.length > 0 && value.elapsedMs >= 1000,
      );
      expect(firing.handRaised).toBe(true);
      const shots = firing.shots.filter((shot) => shot.elapsedMs <= 1000);
      expect(shots.length).toBeGreaterThanOrEqual(4);
      expect(shots.length).toBeLessThanOrEqual(5);
      for (const [index, shot] of firing.shots.entries())
        expect(shot.arrows).toBe(32 - index - 1);
      bot.deactivateItem();
      const released = await observeRepeater(
        bot,
        rcon,
        "native release acknowledgement and twelve server ticks",
        (value) =>
          value.release !== null && value.tick - value.release.tick >= 12,
      );
      expect(released.handRaised).toBe(false);
      expect(released.arrows).toBe(released.release?.arrows);
      expect(released.shots.length).toBe(released.release?.shots);
      await repeaterObservation(bot, rcon, "start");
      bot.activateItem();
      await observeRepeater(
        bot,
        rcon,
        "Repeater fires before the hotbar switch",
        (value) => value.shots.length > 0,
      );
      const sword = bot.inventory
        .items()
        .find((item) => item.name === "iron_sword");
      if (sword === undefined) throw new Error("Debug sword is missing");
      await bot.equip(sword, "hand");
      const switched = await observeRepeater(
        bot,
        rcon,
        "native hotbar acknowledgement and twelve server ticks",
        (value) =>
          value.switched !== null && value.tick - value.switched.tick >= 12,
      );
      expect(switched.handRaised).toBe(false);
      expect(switched.arrows).toBe(switched.switched?.arrows);
      expect(switched.shots.length).toBe(switched.switched?.shots);
    } finally {
      bot.deactivateItem();
      await rcon.command(`storm-fixture-repeater clear ${bot.username}`);
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 40_000);

  test("Whirlwind cleaves once per recovery", async ({ bot, rcon }) => {
    await begin(bot, rcon, 15);
    try {
      await rcon.command(`tp ${bot.username} 1815.5 105 2167.5`);
      await waitUntil(
        "combat terrace",
        () =>
          bot.entity.position.distanceTo(new Vec3(1815.5, 105, 2167.5)) < 0.6,
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
      const approach = new Vec3(1812.5, 73, 2273.5);
      await rcon.command(`tp ${bot.username} 1812.5 73 2273.5`);
      await waitUntil(
        "closed wharf approach",
        () => bot.entity.position.distanceTo(approach) < 0.6,
      );
      await bot.lookAt(new Vec3(1818.5, 74.6, 2273.5));
      bot.activateItem();
      await bot.waitForTicks(5);
      expect(bot.entity.position.x).toBeLessThan(1815);
      expect(bot.entity.position.distanceTo(approach)).toBeLessThan(4.5);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 40_000);
});
