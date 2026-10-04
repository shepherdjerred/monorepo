import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";
import { ClearCountOutputSchema } from "#e2e/harness/rcon-output.ts";

const enemies = '@e[nbt={BukkitValues:{"thestorm:arena_entity":"colosseum"}}]';
const chests = ["179 48 2", "227 48 -46", "275 48 2"] as const;

async function itemCount(rcon: RconClient, player: string, item: string) {
  const response = await rcon.command(`clear ${player} minecraft:${item} 0`);
  return response === `No items were found on player ${player}`
    ? 0
    : ClearCountOutputSchema.parse(response).count;
}

async function start(rcon: RconClient) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await rcon.command("arena start colosseum");
    if (response.includes("Started colosseum")) return;
    if (!/prepar|load/iu.test(response)) throw new Error(response);
    await Bun.sleep(500);
  }
  throw new Error("Colosseum chunks never became ready");
}

describe("Colosseum chest access on real Paper", () => {
  test("fighters can open and withdraw from every authored arena chest", async ({
    bot,
    rcon,
  }) => {
    const positions = [
      [179, 48, 2],
      [185, 48, 2],
      [212, 42, 2],
      [227, 48, -40],
      [227, 48, -46],
      [227, 42, -13],
      [225, 42, 2],
      [227, 42, 0],
      [229, 42, 2],
      [227, 42, 4],
      [227, 42, 17],
      [227, 48, 44],
      [227, 48, 50],
      [242, 42, 2],
      [269, 48, 2],
      [275, 48, 2],
    ];
    const joined = waitForMessage(bot, /entered The Colosseum/u);
    bot.chat("/arena join colosseum");
    await joined;
    const selected = waitForMessage(bot, /You are a Knight/u);
    bot.chat("/arena class knight");
    await selected;
    await rcon.command("difficulty normal");
    try {
      const started = waitForMessage(bot, /Wave 1!/u);
      await start(rcon);
      await started;
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      for (const coordinates of positions) {
        const [x, y, z] = coordinates;
        if (x === undefined || y === undefined || z === undefined)
          throw new Error("Invalid chest fixture");
        await rcon.command(
          `tp ${bot.username} ${(x + 0.5).toString()} ${(y + 1).toString()} ${(z + 1.5).toString()}`,
        );
        const position = new Vec3(x, y, z);
        await waitUntil(
          "chest is in reach",
          () =>
            bot.entity.position.distanceTo(position) < 4 &&
            Math.abs(bot.entity.position.x - x - 0.5) < 0.2 &&
            Math.abs(bot.entity.position.z - z - 1.5) < 0.2 &&
            bot.blockAt(position)?.name === "chest",
        );
        const block = bot.blockAt(position);
        if (block === null) throw new Error("Authored chest missing");
        await bot.waitForTicks(5);
        const chest = await bot.openContainer(block);
        try {
          const loot = chest.containerItems()[0];
          if (loot === undefined) throw new Error("Chest was not stocked");
          const { name, type, metadata, count } = loot;
          const before = await itemCount(rcon, bot.username, name);
          await chest.withdraw(type, metadata, count);
          await chest.close();
          await bot.waitForTicks(5);
          const after = await itemCount(rcon, bot.username, name);
          expect(after, `Chest ${coordinates.join(",")} delivers ${name}`).toBe(
            before + count,
          );
        } finally {
          if (bot.currentWindow !== null) await chest.close();
        }
        await bot.waitForTicks(5);
      }
    } finally {
      await rcon.command("arena stop colosseum");
      await rcon.command("difficulty peaceful");
    }
  }, 120_000);
});

describe("Colosseum on real Paper", () => {
  test("distant zombies pursue a fighter across the arena floor", async ({
    bot,
    rcon,
  }) => {
    const joined = waitForMessage(bot, /entered The Colosseum/u);
    bot.chat("/arena join colosseum");
    await joined;
    const selected = waitForMessage(bot, /You are a Knight/u);
    bot.chat("/arena class knight");
    await selected;
    await rcon.command("difficulty normal");
    try {
      const started = waitForMessage(bot, /Wave 1!/u);
      await start(rcon);
      await started;
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance infinite 255 true`,
      );
      await rcon.command(`tp ${bot.username} 200.5 42 2.5`);
      await rcon.command(
        "tp @e[type=minecraft:zombie,x=164,y=30,z=-60,dx=126,dy=70,dz=124] 250.5 42 2.5",
      );
      await waitUntil(
        "three distant zombies",
        () =>
          Object.values(bot.entities).filter(
            (e) =>
              e.name === "zombie" &&
              e.position.distanceTo(bot.entity.position) > 35,
          ).length >= 3,
      );
      await waitUntil(
        "zombies walk toward the fighter before stuck recovery",
        () =>
          Object.values(bot.entities).some(
            (e) =>
              e.name === "zombie" &&
              e.position.distanceTo(bot.entity.position) < 40,
          ),
        15_000,
      );
      await waitUntil(
        "a zombie reaches melee range",
        () =>
          Object.values(bot.entities).some(
            (e) =>
              e.name === "zombie" &&
              e.position.distanceTo(bot.entity.position) < 3,
          ),
        40_000,
      );
    } finally {
      await rcon.command("arena stop colosseum");
      await rcon.command("difficulty peaceful");
    }
  }, 90_000);

  test("caches replenish, class gear grows and party bosses warn before casting", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    for (const player of [bot, secondBot]) {
      const joined = waitForMessage(player, /entered The Colosseum/u);
      player.chat("/arena join colosseum");
      await joined;
      const selected = waitForMessage(player, /You are a Knight/u);
      player.chat("/arena class knight");
      await selected;
    }
    let wave = 0;
    const onMessage = (message: string) => {
      const matched = /Wave (\d+)(?:!|:)/u.exec(message);
      if (matched?.[1] !== undefined) wave = Number(matched[1]);
    };
    bot.on("messagestr", onMessage);
    await rcon.command("difficulty normal");
    try {
      const started = waitForMessage(bot, /Wave 1!/u);
      await start(rcon);
      await started;
      for (const player of [bot, secondBot]) {
        await rcon.command(
          `effect give ${player.username} minecraft:resistance infinite 255 true`,
        );
      }
      expect(bot.inventory.items().some((i) => i.name === "stone_sword")).toBe(
        true,
      );
      expect(
        await rcon.command(
          `data get entity ${bot.username} equipment.chest.id`,
        ),
      ).toContain("minecraft:leather_chestplate");
      for (const chest of chests) {
        expect(await rcon.command(`data get block ${chest} Items`)).toContain(
          "minecraft:",
        );
        await rcon.command(`data modify block ${chest} Items set value []`);
      }
      // An unclaimed stack survives the top-up rather than being erased by a refill.
      await rcon.command(
        `data modify block ${chests[0]} Items set value [{Slot:26b,id:"minecraft:copper_ingot",count:1}]`,
      );
      while (wave < 16) {
        const current = wave;
        if (current === 6) {
          await waitUntil("iron class weapon", () =>
            bot.inventory.items().some((i) => i.name === "iron_sword"),
          );
          expect(
            await rcon.command(
              `data get entity ${bot.username} equipment.chest.id`,
            ),
          ).toContain("minecraft:iron_chestplate");
          for (const chest of chests)
            expect(
              await rcon.command(`data get block ${chest} Items`),
            ).toContain("minecraft:");
          expect(
            await rcon.command(
              `data get block ${chests[0]} Items[{Slot:26b}].id`,
            ),
          ).toContain("minecraft:copper_ingot");
          // Simulate damaged cache armor using the same Paper arena-item tag.
          await rcon.command(
            `item replace entity ${bot.username} armor.chest with minecraft:diamond_chestplate[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b}},minecraft:damage=150]`,
          );
          expect(
            await rcon.command(
              `data get entity ${bot.username} equipment.chest.components."minecraft:damage"`,
            ),
          ).toContain("150");
        }
        if (current === 11) {
          expect(
            await rcon.command(
              `data get entity ${bot.username} equipment.chest.id`,
            ),
          ).toContain("minecraft:diamond_chestplate");
          expect(
            await rcon.command(
              `execute if items entity ${bot.username} armor.chest minecraft:diamond_chestplate[minecraft:damage=0] run data get entity ${bot.username} equipment.chest.id`,
            ),
          ).toContain("minecraft:diamond_chestplate");
        }
        if (current === 10) {
          const health = await rcon.command(
            "attribute @e[type=minecraft:parched,x=164,y=30,z=-60,dx=126,dy=70,dz=124,limit=1] minecraft:max_health get",
          );
          expect(health).toContain("234");
          const warning = waitForMessage(
            bot,
            /The Parched King: Ground slam/u,
            20_000,
          );
          await warning;
          const phase = waitForMessage(bot, /The Parched King is enraged/u);
          await rcon.command(
            "damage @e[type=minecraft:parched,x=164,y=30,z=-60,dx=126,dy=70,dz=124,limit=1] 160 minecraft:generic",
          );
          await phase;
          // Its summon spell is telegraphed too, before scaled reinforcements arrive.
          const adds = waitForMessage(bot, /Reinforcements incoming/u, 30_000);
          await adds;
          await waitUntil(
            "telegraphed boss reinforcements arrive",
            () =>
              Object.values(bot.entities).filter((e) => e.name === "bogged")
                .length >= 3,
            10_000,
          );
          expect(
            Object.values(bot.entities).filter((e) => e.name === "bogged")
              .length,
          ).toBeGreaterThanOrEqual(3);
        }
        await rcon.command(`kill ${enemies}`);
        await waitUntil("next wave", () => wave > current, 15_000);
      }
      await waitUntil("diamond class weapon", () =>
        bot.inventory.items().some((i) => i.name === "diamond_sword"),
      );
      expect(
        await rcon.command(
          `data get entity ${bot.username} equipment.chest.id`,
        ),
      ).toContain("minecraft:diamond_chestplate");
      expect(
        await rcon.command(
          `data get entity ${secondBot.username} equipment.chest.id`,
        ),
      ).toContain("minecraft:iron_chestplate");
    } finally {
      bot.off("messagestr", onMessage);
      await rcon.command("arena stop colosseum");
      await rcon.command("difficulty peaceful");
    }
  }, 240_000);
});
