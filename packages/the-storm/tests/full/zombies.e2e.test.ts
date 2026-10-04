import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { z } from "zod";
import { ClearCountOutputSchema } from "#e2e/harness/rcon-output.ts";

const tagged = '@e[nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}]';

async function join(bot: Bot, round?: number) {
  const joined = waitForMessage(bot, /Survival: Fighter/u);
  bot.chat(
    round === undefined
      ? "/arena join settlement"
      : `/arena join settlement ${round.toString()}`,
  );
  await joined;
}

async function travel(bot: Bot, rcon: RconClient, pos: Vec3) {
  await rcon.command(
    `tp ${bot.username} ${pos.x.toString()} ${pos.y.toString()} ${pos.z.toString()}`,
  );
  await waitUntil(
    "arrive at fixture",
    () => bot.entity.position.distanceTo(pos) < 0.6,
  );
}

async function click(bot: Bot, pos: Vec3) {
  await waitUntil("fixture is loaded", () => bot.blockAt(pos) !== null);
  const block = bot.blockAt(pos);
  if (block === null) throw new Error("Fixture missing");
  await bot.activateBlock(block);
}

async function protect(bot: Bot, rcon: RconClient) {
  await rcon.command(
    `effect give ${bot.username} minecraft:resistance infinite 255 true`,
  );
}

describe("classic Zombies systems on real Paper", () => {
  test("debug permission creates a shared lobby, with ready countdown and scaled first boss", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    bot.chat("/arena join settlement 5");
    await Bun.sleep(500);
    expect(bot.inventory.items().some((i) => i.name === "stone_sword")).toBe(
      false,
    );
    await rcon.command(`op ${bot.username}`);
    await join(bot, 5);
    await join(secondBot);
    expect(bot.entity.position.x).toBeLessThan(1740);
    expect(bot.inventory.items().some((i) => i.name === "iron_sword")).toBe(
      false,
    );
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 5:/u, 25_000);
      bot.chat("/arena ready");
      secondBot.chat("/arena ready");
      await round;
      await protect(bot, rcon);
      await protect(secondBot, rcon);
      expect(bot.inventory.items().some((i) => i.name === "iron_sword")).toBe(
        true,
      );
      expect(
        await rcon.command(
          `attribute @e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1] minecraft:max_health get`,
        ),
      ).toContain("330");
      const warning = await waitForMessage(
        bot,
        /Breeze Sovereign casts Wind lanes.*marked ground.*Phase 1/u,
        15_000,
      );
      expect(warning.join("\n")).toContain("marked ground");
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 75_000);
});

describe("settlement resources and expeditions on real Paper", () => {
  test("a Medic buys a priced route only after two main-hand sign clicks", async ({
    bot,
    rcon,
  }) => {
    await join(bot);
    const selected = waitForMessage(bot, /Selected MEDIC/u);
    bot.chat("/arena class medic");
    await selected;
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 1:/u);
      await rcon.command("arena start settlement");
      await round;
      await protect(bot, rcon);
      await waitUntil(
        "Medic starting supplies",
        () =>
          bot.inventory.items().find((i) => i.name === "golden_apple")
            ?.count === 2,
      );
      const runData = await rcon.command(
        `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data"`,
      );
      expect(runData).toContain('"thestorm:survival_run"');
      const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(runData)?.[0]);
      await rcon.command(
        `give ${bot.username} minecraft:emerald[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] 24`,
      );
      await travel(bot, rcon, new Vec3(1807.5, 73, 2153.5));
      expect(
        await rcon.command("data get block 1808 73 2153 front_text.messages"),
      ).toContain("12 emeralds");
      const quote = waitForMessage(
        bot,
        /costs 12 emeralds.*Click this sign again/u,
      );
      await click(bot, new Vec3(1808, 73, 2153));
      await quote;
      expect(
        ClearCountOutputSchema.parse(
          await rcon.command(`clear ${bot.username} minecraft:emerald 0`),
        ).count,
      ).toBe(24);
      const opened = waitForMessage(bot, /opened Tidecut Quarry/u);
      await bot.waitForTicks(5);
      await click(bot, new Vec3(1808, 73, 2153));
      await opened;
      expect(
        ClearCountOutputSchema.parse(
          await rcon.command(`clear ${bot.username} minecraft:emerald 0`),
        ).count,
      ).toBe(12);
      expect(
        await rcon.command("execute if block 1810 73 2155 minecraft:air"),
      ).toBe("Test passed");
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 45_000);
});

describe("settlement expeditions on real Paper", () => {
  test("food harvests and nearest rescue work in a live run", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await join(bot, 4);
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 4:/u);
      await rcon.command("arena start settlement");
      await round;
      await protect(bot, rcon);
      await travel(bot, rcon, new Vec3(1834.5, 73, 2190.5));
      const power = waitForMessage(bot, /The fortress has power/u);
      await click(bot, new Vec3(1834, 73, 2189));
      await power;
      expect(
        bot.inventory.items().find((i) => i.name === "iron_ingot")?.count,
      ).toBe(12);
      expect(
        bot.inventory.items().find((i) => i.name === "redstone")?.count,
      ).toBe(12);
      await travel(bot, rcon, new Vec3(1780.5, 73, 2169.5));
      await click(bot, new Vec3(1780, 73, 2168));
      await waitUntil("nine wheat from one harvest", () =>
        bot.inventory.items().some((i) => i.name === "wheat" && i.count === 9),
      );
      await travel(bot, rcon, new Vec3(1783.5, 73, 2164.5));
      const before = bot.inventory
        .items()
        .filter((i) => i.name === "bread")
        .reduce((n, i) => n + i.count, 0);
      await click(bot, new Vec3(1783, 73, 2163));
      await waitUntil(
        "food purchase",
        () =>
          bot.inventory
            .items()
            .filter((i) => i.name === "bread")
            .reduce((n, i) => n + i.count, 0) ===
          before + 3,
      );
      await travel(bot, rcon, new Vec3(1859.5, 73, 2218.5));
      await rcon.command(`tp ${bot.username} 1865 73 2218`);
      await waitUntil(
        "nearest foundry rescue",
        () => bot.entity.position.x < 1862,
      );
      expect(bot.entity.position.x).toBeGreaterThan(1809);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 75_000);

  test("power, perks, plane cargo, offshore upgrades and independent return preserve combat", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await join(bot, 8);
    await join(secondBot);
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 8:/u);
      await rcon.command("arena start settlement");
      await round;
      await protect(bot, rcon);
      await protect(secondBot, rcon);
      for (const [part, approach] of [
        [new Vec3(1853, 73, 2152), new Vec3(1853.5, 73, 2153.5)],
        [new Vec3(1837, 73, 2203), new Vec3(1837.5, 73, 2204.5)],
        [new Vec3(1799, 73, 2243), new Vec3(1799.5, 73, 2244.5)],
      ]) {
        if (part === undefined || approach === undefined)
          throw new Error("Plane fixture missing");
        await travel(bot, rcon, approach);
        const carried = waitForMessage(bot, /Carrying .*Install it/u);
        await click(bot, part);
        await carried;
        await travel(bot, rcon, new Vec3(1757.5, 81, 2242.5));
        const installed = waitForMessage(bot, /Installed cargo/u);
        await click(bot, new Vec3(1756, 81, 2241));
        await installed;
      }
      await travel(bot, rcon, new Vec3(1765.5, 73, 2186.5));
      const perk = waitForMessage(bot, /Purchased JUGGERNOG/u);
      await click(bot, new Vec3(1765, 73, 2185));
      await perk;
      expect(
        await rcon.command(
          `attribute ${bot.username} minecraft:max_health get`,
        ),
      ).toContain("28");
      await travel(bot, rcon, new Vec3(1757.5, 81, 2242.5));
      const landed = waitForMessage(bot, /Offshore forge/u, 15_000);
      await click(bot, new Vec3(1756, 81, 2241));
      await landed;
      expect(secondBot.entity.position.x).toBeGreaterThan(1740);
      await travel(bot, rcon, new Vec3(1727.5, 73, 2211.5));
      const weapon = bot.inventory.items().find((i) => i.name === "iron_sword");
      if (weapon === undefined) throw new Error("Practice weapon missing");
      await bot.equip(weapon, "hand");
      const upgrade = waitForMessage(bot, /Pack-a-Punch 2/u);
      await click(bot, new Vec3(1727, 73, 2209));
      await upgrade;
      expect(
        await rcon.command(
          `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data"`,
        ),
      ).toContain('"thestorm:survival_upgrade": 2');
      await travel(bot, rcon, new Vec3(1727.5, 73, 2224.5));
      const returned = waitForMessage(bot, /Back at the fortress/u, 15_000);
      await click(bot, new Vec3(1727, 73, 2225));
      await returned;
      expect(bot.entity.position.x).toBeGreaterThan(1740);
      await rcon.command(`effect clear ${bot.username} minecraft:resistance`);
      const down = waitForMessage(bot, /Downed!/u);
      await rcon.command(`damage ${bot.username} 100 minecraft:generic`);
      await down;
      expect(
        await rcon.command(
          `attribute ${bot.username} minecraft:max_health get`,
        ),
      ).toContain("20");
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 150_000);

  test("cube specials move toward fighters and make native contact attacks", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await join(bot, 8);
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 8:/u);
      await rcon.command("arena start settlement");
      await round;
      await travel(bot, rcon, new Vec3(1788.5, 73, 2158.5));
      await protect(bot, rcon);
      const contact = waitForMessage(
        bot,
        /Fixture cube made a native contact attack/u,
        30_000,
      );
      expect(
        await rcon.command(`storm-fixture-cube arena-slime ${bot.username}`),
      ).toContain("Spawned native cube");
      await waitUntil(
        "cube closes the distance by hopping",
        () =>
          Object.values(bot.entities).some(
            (e) =>
              e.name === "slime" &&
              e.position.distanceTo(bot.entity.position) < 5,
          ),
        20_000,
      );
      await contact;
      expect(
        await rcon.command(
          `execute as ${tagged} run data get entity @s Health`,
        ),
      ).toContain("f");
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 60_000);
});
