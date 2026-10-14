import type { Bot } from "mineflayer";
import { randomBytes } from "node:crypto";
import { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { disconnectBot, waitUntil } from "./harness/bot.ts";
import { setRwfFeatures } from "./harness/fake-brain.ts";
import {
  count,
  connect,
  health,
  hotbar,
  human,
  inView,
  join,
  teleport,
  yard,
} from "./harness/rwf-humans.ts";
import { eventually, waitForLobby } from "./harness/rwf-match.ts";
import type { RconClient } from "./harness/rcon.ts";

/** Real Paper successful-hit callbacks; deliberately excluded from the light CI smoke lane. */
async function start(
  rcon: RconClient,
  port: number,
  [attacker, victim]: readonly [Bot, Bot],
  [kit, victimKit]: readonly [string, string?],
): Promise<void> {
  await setRwfFeatures(port, []);
  await rcon.command("rwf admin stop");
  await waitForLobby(rcon);
  const a = human(attacker);
  const b = human(victim);
  await join(a);
  expect(
    await rcon.command(`rwf admin forcekit ${attacker.username} ${kit}`),
  ).toContain(`now uses ${kit}`);
  await join(b);
  if (victimKit !== undefined)
    expect(
      await rcon.command(`rwf admin forcekit ${victim.username} ${victimKit}`),
    ).toContain(`now uses ${victimKit}`);
  await a.log.until(/The game has begun!/u, 30_000);
  await b.log.until(/The game has begun!/u, 30_000);
  await rcon.command(
    "execute in minecraft:rwf run gamerule minecraft:natural_health_regeneration false",
  );
}

async function stop(rcon: RconClient): Promise<void> {
  await rcon.command(
    "execute in minecraft:rwf run gamerule minecraft:natural_health_regeneration true",
  );
  await rcon.command("rwf admin stop");
  await waitForLobby(rcon);
}

async function face(attacker: Bot, victim: Bot): Promise<void> {
  await waitUntil(
    "the enemy entity arrives",
    () => inView(attacker, victim) !== undefined,
  );
  await attacker.lookAt(victim.entity.position.offset(0, 1.1, 0), true);
}

async function select(bot: Bot, item: string): Promise<void> {
  const slot = Array.from({ length: 9 }, (_, index) => index).find(
    (index) => hotbar(bot, index) === item,
  );
  if (slot === undefined)
    throw new Error(`${item} is missing from ${bot.username}'s hotbar`);
  bot.setQuickBarSlot(slot);
  await waitUntil(`${item} is held`, () => bot.heldItem?.name === item);
}

async function shot(bot: Bot, chargeTicks: number): Promise<void> {
  bot.activateItem();
  await bot.waitForTicks(chargeTicks);
  bot.deactivateItem();
}

/** The nuke pedestal occupies z30..32. Keep native arrows in an unobstructed lane. */
async function firingLane(
  rcon: RconClient,
  fighters: readonly Bot[],
): Promise<void> {
  for (const [index, fighter] of fighters.entries()) {
    const at = new Vec3(20.5 + index * 4, 65, 26.5);
    await teleport(rcon, fighter, at);
  }
  for (let x = 20; x <= 36; x++) {
    for (const y of [65, 66]) {
      expect(
        await rcon.command(
          `execute in minecraft:rwf if block ${x.toString()} ${y.toString()} 26 minecraft:air`,
        ),
      ).toContain("Test passed");
    }
  }
}

async function prioritiseTipped(bot: Bot, rcon: RconClient): Promise<void> {
  await select(bot, "tipped_arrow");
  // The vanilla F key uses SWAP_ITEM_WITH_OFFHAND, without client-predicted inventory clicks.
  bot._client.write("block_dig", {
    status: 6,
    location: new Vec3(0, 0, 0),
    face: 0,
    sequence: 0,
  });
  await eventually(
    "the server prioritises native offhand ammunition",
    async () => {
      const reply = await rcon.command(
        `execute if items entity ${bot.username} weapon.offhand minecraft:tipped_arrow`,
      );
      return reply.includes("Test passed");
    },
  );
  await waitUntil(
    "the offhand stack is acknowledged",
    () =>
      bot.inventory.slots[45]?.name === "tipped_arrow" &&
      bot.inventory.slots[45]?.count === 8,
  );
}

describe("Native expansion weapon completion", () => {
  for (const [kit, arrows, projectiles] of [
    ["arbalist", 48, 1],
    ["volley", 36, 3],
  ] as const) {
    test(
      `${kit} loads one finite arrow and fires ${projectiles.toString()} native projectiles`,
      { timeout: 90_000 },
      async ({ bot, secondBot, rcon, brain }) => {
        try {
          await start(rcon, brain.port, [bot, secondBot], [kit]);
          await firingLane(rcon, [bot, secondBot]);
          await select(bot, "crossbow");
          await face(bot, secondBot);
          expect(count(bot, "arrow")).toBe(arrows);
          await shot(bot, 30);
          await waitUntil(
            "one arrow loaded",
            () => count(bot, "arrow") === arrows - 1,
          );
          const spawned = new Set<number>();
          // Client tracking proves distinct projectiles, rather than deriving their count from the enchantment.
          const record = (entity: Bot["entity"]) => {
            if (entity.name === "arrow") spawned.add(entity.id);
          };
          bot.on("entitySpawn", record);
          try {
            const before = await health(rcon, secondBot);
            bot.activateItem();
            bot.deactivateItem();
            await waitUntil(
              "all native crossbow projectiles",
              () => spawned.size === projectiles,
            );
            await eventually(
              "the native crossbow hit",
              async () => (await health(rcon, secondBot)) < before,
            );
            expect(count(bot, "arrow")).toBe(arrows - 1);
          } finally {
            bot.off("entitySpawn", record);
          }
        } finally {
          await stop(rcon);
        }
      },
    );
  }

  test(
    "Piercing completes successful hits on two aligned enemies with one arrow",
    { timeout: 90_000 },
    async ({ bot, secondBot, rcon, brain, server }) => {
      const third = await connect(
        server,
        `pierce_${randomBytes(4).toString("hex")}`,
      );
      try {
        await setRwfFeatures(brain.port, []);
        await rcon.command("rwf admin stop");
        await waitForLobby(rcon);
        const fighters = [human(bot), human(secondBot), human(third)];
        for (const [index, fighter] of fighters.entries()) {
          await join(fighter);
          const kit = index === 0 ? "arbalist" : "trooper";
          expect(
            await rcon.command(
              `rwf admin forcekit ${fighter.bot.username} ${kit}`,
            ),
          ).toContain(`now uses ${kit}`);
          expect(
            await rcon.command(
              `rwf admin team ${fighter.bot.username} ${index === 0 ? "red" : "blue"}`,
            ),
          ).toContain("plays for");
        }
        for (const fighter of fighters)
          await fighter.log.until(/The game has begun!/u, 30_000);
        await rcon.command(
          "execute in minecraft:rwf run gamerule minecraft:natural_health_regeneration false",
        );
        await firingLane(rcon, [bot, secondBot, third]);
        await select(bot, "crossbow");
        await face(bot, secondBot);
        await shot(bot, 30);
        bot.activateItem();
        bot.deactivateItem();
        await eventually(
          "both native piercing hits",
          async () =>
            (await health(rcon, secondBot)) < 20 &&
            (await health(rcon, third)) < 20,
        );
        expect(count(bot, "arrow")).toBe(47);
      } finally {
        await disconnectBot(third);
        await stop(rcon);
      }
    },
  );

  test(
    "a successful Loyalty hit returns the thrown trident to its owner",
    { timeout: 90_000 },
    async ({ bot, secondBot, rcon, brain }) => {
      try {
        await start(rcon, brain.port, [bot, secondBot], ["harpooner"]);
        await firingLane(rcon, [bot, secondBot]);
        await select(bot, "trident");
        await face(bot, secondBot);
        const before = await health(rcon, secondBot);
        await shot(bot, 15);
        await waitUntil(
          "the trident leaves its owner",
          () => count(bot, "trident") === 0,
        );
        await eventually(
          "the thrown trident deals damage",
          async () => (await health(rcon, secondBot)) < before,
        );
        await waitUntil(
          "Loyalty returns the trident",
          () => count(bot, "trident") === 1,
          15_000,
        );
      } finally {
        await stop(rcon);
      }
    },
  );

  test(
    "a Fletcher arrow delivers three seconds of Slowness and consumes tipped ammunition",
    { timeout: 90_000 },
    async ({ bot, secondBot, rcon, brain }) => {
      try {
        await start(rcon, brain.port, [bot, secondBot], ["fletcher"]);
        await firingLane(rcon, [bot, secondBot]);
        await prioritiseTipped(bot, rcon);
        await select(bot, "bow");
        await face(bot, secondBot);
        await shot(bot, 25);
        await waitUntil(
          "the tipped arrow is fired",
          () => bot.inventory.slots[45]?.count === 7,
        );
        await eventually(
          "Slowness survives the native hit callback",
          async () => {
            const reply = await rcon.command(
              `execute if entity @a[name=${secondBot.username},nbt={active_effects:[{id:"minecraft:slowness"}]}]`,
            );
            return reply.includes("Test passed");
          },
        );
        const slowness = secondBot.registry.effectsByName["Slowness"];
        if (slowness === undefined)
          throw new Error("Native registry lacks Slowness");
        await waitUntil(
          "the client receives Slowness I",
          () => secondBot.entity.effects[slowness.id]?.amplifier === 0,
        );
        expect(bot.inventory.slots[45]?.count).toBe(7);
        expect(count(bot, "arrow")).toBe(24);
        const duration = await rcon.command(
          `data get entity ${secondBot.username} active_effects[{id:"minecraft:slowness"}].duration`,
        );
        const remaining = /: (?<ticks>\d+)$/u.exec(duration)?.groups?.["ticks"];
        if (remaining === undefined)
          throw new Error(`No native Slowness duration: ${duration}`);
        expect(Number(remaining)).toBeGreaterThan(35);
        expect(Number(remaining)).toBeLessThanOrEqual(60);
        await eventually(
          "Slowness expires",
          async () => {
            const reply = await rcon.command(
              `execute unless entity @a[name=${secondBot.username},nbt={active_effects:[{id:"minecraft:slowness"}]}]`,
            );
            return reply.includes("Test passed");
          },
          5000,
        );
      } finally {
        await stop(rcon);
      }
    },
  );
});

describe("Native expansion melee completion", () => {
  test(
    "a native mace fall adds smash damage beyond a grounded hit",
    { timeout: 90_000 },
    async ({ bot, secondBot, rcon, brain }) => {
      try {
        await start(rcon, brain.port, [bot, secondBot], ["maceguard"]);
        await select(bot, "mace");
        await teleport(rcon, bot, yard.duel[0]);
        await teleport(rcon, secondBot, yard.duel[1]);
        await face(bot, secondBot);
        await bot.waitForTicks(35);
        const target = inView(bot, secondBot);
        if (target === undefined)
          throw new Error("The mace victim is not tracked");
        bot.attack(target);
        await eventually(
          "the grounded native mace hit",
          async () => (await health(rcon, secondBot)) < 20,
        );
        const grounded = 20 - (await health(rcon, secondBot));
        await rcon.command(
          `effect give ${secondBot.username} minecraft:instant_health 1 10 true`,
        );
        await eventually(
          "the victim is healed for comparison",
          async () => (await health(rcon, secondBot)) === 20,
        );
        await teleport(rcon, secondBot, yard.duel[1]);
        await bot.waitForTicks(35);
        await teleport(rcon, bot, yard.duel[0].offset(0, 6, 0));
        await face(bot, secondBot);
        await waitUntil(
          "the mace enters native reach while falling",
          () => bot.entity.position.y < 67.5,
        );
        const fallingTarget = inView(bot, secondBot);
        if (fallingTarget === undefined)
          throw new Error("The falling mace victim is not tracked");
        bot.attack(fallingTarget);
        await eventually(
          "the native falling smash",
          async () => (await health(rcon, secondBot)) < 20 - grounded - 2,
        );
      } finally {
        await stop(rcon);
      }
    },
  );
});

describe("Smoke visibility on a real client connection", () => {
  test(
    "overlapping smoke remains hidden until the last field expires and then restores both directions",
    { timeout: 90_000 },
    async ({ bot, secondBot, rcon, brain }) => {
      try {
        await start(
          rcon,
          brain.port,
          [bot, secondBot],
          ["smokescreen", "smokescreen"],
        );
        await teleport(rcon, bot, yard.duel[0]);
        await teleport(rcon, secondBot, yard.duel[1]);
        await face(bot, secondBot);
        await face(secondBot, bot);
        await select(bot, "gray_dye");
        bot.activateItem();
        bot.deactivateItem();
        await waitUntil(
          "smoke removes enemy tracking",
          () =>
            inView(bot, secondBot) === undefined &&
            inView(secondBot, bot) === undefined,
        );
        await bot.waitForTicks(40);
        await select(secondBot, "gray_dye");
        const beforeSecondCast = secondBot.experience.progress;
        secondBot.activateItem();
        secondBot.deactivateItem();
        await waitUntil(
          "the second smoke cast starts its native cooldown bar",
          () =>
            secondBot.experience.progress !== beforeSecondCast &&
            secondBot.experience.progress > 0 &&
            secondBot.experience.progress < 0.25,
        );
        await secondBot.waitForTicks(90);
        expect(inView(bot, secondBot)).toBeUndefined();
        expect(inView(secondBot, bot)).toBeUndefined();
        await waitUntil(
          "expiry restores both enemy entities",
          () =>
            inView(bot, secondBot) !== undefined &&
            inView(secondBot, bot) !== undefined,
          10_000,
        );
      } finally {
        await stop(rcon);
      }
    },
  );
});
