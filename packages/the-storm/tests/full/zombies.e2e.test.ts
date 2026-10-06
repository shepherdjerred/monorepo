import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { test } from "#e2e/arena-fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { z } from "zod";
import { ClearCountOutputSchema } from "#e2e/harness/rcon-output.ts";

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
    `minecraft:tp ${bot.username} ${pos.x.toString()} ${pos.y.toString()} ${pos.z.toString()}`,
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
    expect(bot.entity.position.x).toBeLessThan(-52);
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
      ).toContain("280.5");
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
        `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
      );
      const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(runData)?.[0]);
      await rcon.command(
        `give ${bot.username} minecraft:emerald[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] 24`,
      );
      await travel(bot, rcon, new Vec3(20.5, 73, 64.5));
      expect(
        await rcon.command("data get block 21 73 64 front_text.messages"),
      ).toContain("8 emeralds");
      const quote = waitForMessage(
        bot,
        /costs 8 emeralds.*Click this sign again/u,
      );
      await click(bot, new Vec3(21, 73, 64));
      await quote;
      expect(
        ClearCountOutputSchema.parse(
          await rcon.command(`clear ${bot.username} minecraft:emerald 0`),
        ).count,
      ).toBe(24);
      const opened = waitForMessage(bot, /opened Smugglers' Wharf/u);
      await bot.waitForTicks(5);
      await click(bot, new Vec3(21, 73, 64));
      await opened;
      expect(
        ClearCountOutputSchema.parse(
          await rcon.command(`clear ${bot.username} minecraft:emerald 0`),
        ).count,
      ).toBe(16);
      expect(
        await rcon.command("execute if block 23 73 64 minecraft:air"),
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
      await travel(bot, rcon, new Vec3(58.5, 89, 3.5));
      const power = waitForMessage(bot, /The fortress has power/u);
      await click(bot, new Vec3(58, 89, 2));
      await power;
      expect(
        bot.inventory.items().find((i) => i.name === "iron_ingot")?.count,
      ).toBe(12);
      expect(
        bot.inventory.items().find((i) => i.name === "redstone")?.count,
      ).toBe(12);
      await travel(bot, rcon, new Vec3(-11.5, 73, 50.5));
      await click(bot, new Vec3(-12, 73, 49));
      await waitUntil("nine wheat from one harvest", () =>
        bot.inventory.items().some((i) => i.name === "wheat" && i.count === 9),
      );
      await travel(bot, rcon, new Vec3(-3.5, 73, 53.5));
      const before = bot.inventory
        .items()
        .filter((i) => i.name === "bread")
        .reduce((n, i) => n + i.count, 0);
      await click(bot, new Vec3(-4, 73, 52));
      await waitUntil(
        "food purchase",
        () =>
          bot.inventory
            .items()
            .filter((i) => i.name === "bread")
            .reduce((n, i) => n + i.count, 0) ===
          before + 3,
      );
      await travel(bot, rcon, new Vec3(55.5, 89, 1.5));
      await rcon.command(`minecraft:tp ${bot.username} 81 89 1`);
      await waitUntil(
        "nearest foundry rescue",
        () => bot.entity.position.x < 72,
      );
      expect(bot.entity.position.x).toBeGreaterThan(35);
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 75_000);

  test("power, boons, plane cargo, offshore upgrades and independent return preserve combat", async ({
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
        [new Vec3(65, 73, 39), new Vec3(65.5, 73, 40.5)],
        [new Vec3(57, 89, 5), new Vec3(57.5, 89, 6.5)],
        [new Vec3(27, 105, -38), new Vec3(27.5, 105, -36.5)],
      ]) {
        if (part === undefined || approach === undefined)
          throw new Error("Plane fixture missing");
        await travel(bot, rcon, approach);
        const carried = waitForMessage(bot, /Carrying .*Install it/u);
        await click(bot, part);
        await carried;
        await travel(bot, rcon, new Vec3(61.5, 105, -49.5));
        const installed = waitForMessage(bot, /Installed cargo/u);
        await click(bot, new Vec3(60, 105, -51));
        await installed;
      }
      await travel(bot, rcon, new Vec3(-27.5, 89, -17.5));
      const perk = waitForMessage(bot, /Equipped Stoneward/u);
      await click(bot, new Vec3(-28, 89, -19));
      await waitUntil("boon menu", () => bot.currentWindow !== null);
      await bot.clickWindow(0, 0, 0);
      await perk;
      expect(
        await rcon.command(
          `attribute ${bot.username} minecraft:max_health get`,
        ),
      ).toContain("20");
      await travel(bot, rcon, new Vec3(61.5, 105, -49.5));
      const landed = waitForMessage(bot, /Offshore Runeforge/u, 15_000);
      await click(bot, new Vec3(60, 105, -51));
      await landed;
      expect(secondBot.entity.position.x).toBeGreaterThan(-52);
      await travel(bot, rcon, new Vec3(-64.5, 73, 3.5));
      const weapon = bot.inventory.items().find((i) => i.name === "iron_sword");
      if (weapon === undefined) throw new Error("Practice weapon missing");
      await bot.equip(weapon, "hand");
      const upgrade = waitForMessage(bot, /Runeforge augmentation 2/u);
      await click(bot, new Vec3(-65, 73, 1));
      await waitUntil("equipment selection", () => bot.currentWindow !== null);
      await bot.clickWindow(0, 0, 0);
      await upgrade;
      if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
      expect(
        await rcon.command(
          `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_upgrade"`,
        ),
      ).toMatch(/: 2$/u);
      await travel(bot, rcon, new Vec3(-64.5, 73, 16.5));
      const returned = waitForMessage(bot, /Back at the fortress/u, 15_000);
      await click(bot, new Vec3(-65, 73, 17));
      await returned;
      expect(bot.entity.position.x).toBeGreaterThan(-52);
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
    // Isolate the factory probe from random ranged and explosive specials.
    await join(bot, 1);
    await rcon.command("difficulty normal");
    try {
      const round = waitForMessage(bot, /Round 1:/u);
      await rcon.command("arena start settlement");
      await round;
      expect(
        await rcon.command(
          `storm-fixture-survival terrain ${bot.username} none`,
        ),
      ).toContain("Opened test terrain routes");
      await travel(bot, rcon, new Vec3(27.5, 73, 65.5));
      const health = bot.health;
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
      await waitUntil(
        "native cube damage reaches the client",
        () => bot.health < health,
      );
      expect(bot.health).toBeGreaterThan(0);
      expect(
        await rcon.command(
          "data get entity @e[tag=storm_fixture_cube,limit=1] Health",
        ),
      ).toContain("f");
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 60_000);
});
