import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

const at = (x: number, y: number, z: number) => new Vec3(x, y, z);

describe("settlement opening on real Paper", () => {
  test(
    "a solo starter kit clears round one without a baby swarm or self revive",
    { timeout: 120_000 },
    async ({ bot, rcon }) => {
      const joined = waitForMessage(bot, /Survival: Fighter/u);
      bot.chat("/arena join settlement");
      await joined;
      await rcon.command("difficulty hard");
      const messages: string[] = [];
      const listen = (message: string) => {
        messages.push(message);
      };
      bot.on("messagestr", listen);
      try {
        const round = waitForMessage(bot, /Round 1:/u);
        await rcon.command("arena start settlement");
        await round;
        // Use the open market route also exercised by the pursuit test.
        await rcon.command(`tp ${bot.username} 1774.5 73 2166.5`);
        await Bun.sleep(8000);
        const enemies =
          '@e[type=minecraft:zombie,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}]';
        const adults = await rcon.command(
          `execute as ${enemies} run data get entity @s IsBaby`,
        );
        expect(adults.match(/0b/gu)).toHaveLength(3);
        expect(adults).not.toContain("1b");
        const health = await rcon.command(
          `execute as ${enemies} run data get entity @s Health`,
        );
        expect(health.match(/12\.0f/gu)).toHaveLength(3);
        const reinforcements = await rcon.command(
          `execute as ${enemies} run attribute @s minecraft:spawn_reinforcements base get`,
        );
        expect(reinforcements.match(/is 0\.0/gu)).toHaveLength(3);
        const sword = bot.inventory
          .items()
          .find((item) => item.name === "stone_sword");
        if (sword === undefined) throw new Error("Starter sword is missing");
        await bot.equip(sword, "hand");
        const deadline = Date.now() + 80_000;
        while (
          !messages.some((message) => message.includes("Round 1 cleared"))
        ) {
          expect(
            messages.some((message) => /self-revive|Downed!/u.test(message)),
          ).toBe(false);
          if (Date.now() > deadline)
            throw new Error("Starter melee did not clear round one");
          const enemy = Object.values(bot.entities)
            .filter(
              (entity) =>
                entity.name === "zombie" &&
                entity.position.distanceTo(bot.entity.position) < 3,
            )
            .sort(
              (a, b) =>
                a.position.distanceTo(bot.entity.position) -
                b.position.distanceTo(bot.entity.position),
            )[0];
          if (enemy !== undefined) {
            await bot.lookAt(enemy.position.offset(0, 1.4, 0));
            bot.deactivateItem();
            bot.attack(enemy);
          }
          // Use the Fighter's actual starter shield between sword swings.
          bot.activateItem(true);
          await Bun.sleep(700);
        }
        expect(
          messages.some((message) => /self-revive|Downed!/u.test(message)),
        ).toBe(false);
        expect(bot.health).toBeGreaterThan(0);
        const emeralds = bot.inventory
          .items()
          .find((item) => item.name === "emerald")?.count;
        const nuke = messages.some((m) => m.includes("Team power-up: NUKE"));
        const double = messages.some((m) =>
          m.includes("Team power-up: DOUBLE_EMERALDS"),
        );
        if (!nuke && !double) expect(emeralds).toBe(12);
        else {
          expect(emeralds).toBeGreaterThanOrEqual(nuke ? 2 : 12);
          expect(emeralds).toBeLessThanOrEqual(double ? 24 : 12);
          expect((emeralds ?? 0) % 2).toBe(0);
        }
      } finally {
        bot.deactivateItem();
        bot.off("messagestr", listen);
        await rcon.command("arena stop settlement");
        await rcon.command("difficulty peaceful");
      }
    },
  );
});

describe("settlement survival on real Paper", () => {
  test("classes, finite gathering, crafting, emerald credit and restoration", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`give ${bot.username} diamond 3`);
    const joined = waitForMessage(bot, /Survival: Fighter/u);
    bot.chat("/arena join settlement");
    await joined;
    const locked = waitForMessage(bot, /locked|unlock/iu);
    bot.chat("/arena class engineer");
    await locked;
    const selected = waitForMessage(bot, /Selected RANGER/u);
    bot.chat("/arena class ranger");
    await selected;
    await rcon.command("difficulty normal");
    const round = waitForMessage(bot, /Round 1:/u);
    await rcon.command("arena start settlement");
    await round;

    async function travel(x: number, z: number) {
      await rcon.command(
        `tp ${bot.username} ${x.toString()} 73 ${z.toString()}`,
      );
      await waitUntil(
        "settlement travel",
        () => bot.entity.position.distanceTo(new Vec3(x, 73, z)) < 0.5,
      );
    }
    async function gather(position: Vec3) {
      await waitUntil(
        "authored node arrives",
        () => bot.blockAt(position) !== null,
      );
      const node = bot.blockAt(position);
      if (node === null) throw new Error("Node is missing");
      await bot.activateBlock(node);
    }
    await travel(1759.5, 2147.5);
    await gather(at(1757, 73, 2146));
    await waitUntil("first wood harvest", () =>
      bot.inventory
        .items()
        .some((i) => i.name === "oak_planks" && i.count === 4),
    );
    await gather(at(1757, 73, 2146));
    await waitUntil("second wood harvest", () =>
      bot.inventory
        .items()
        .some((i) => i.name === "oak_planks" && i.count === 8),
    );
    const depleted = waitForMessage(bot, /Depleted for you this round/u);
    await gather(at(1757, 73, 2146));
    await depleted;
    await travel(1764.5, 2164.5);
    await gather(at(1766, 73, 2165));
    await waitUntil("stone harvest", () =>
      bot.inventory
        .items()
        .some((i) => i.name === "cobblestone" && i.count === 4),
    );
    await travel(1762.5, 2150.5);
    const station = bot.blockAt(at(1763, 73, 2148));
    if (station === null) throw new Error("Workbench is missing");
    await bot.activateBlock(station);
    await waitUntil("crafting menu", () => bot.currentWindow !== null);
    await bot.clickWindow(2, 0, 0);
    await waitUntil("crafted arrows", () =>
      bot.inventory.items().some((i) => i.name === "arrow" && i.count === 40),
    );
    expect(
      bot.inventory
        .items()
        .some((i) => i.name === "oak_planks" && i.count === 6),
    ).toBe(true);
    if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);

    const status = waitForMessage(bot, /Round 1.*Emeralds 0/u);
    bot.chat("/survival status");
    await status;
    await rcon.command("arena stop settlement");
    await waitUntil("snapshot restoration", () =>
      bot.inventory.items().some((i) => i.name === "diamond" && i.count === 3),
    );
    expect(
      bot.inventory
        .items()
        .some((i) => i.name === "oak_planks" || i.name === "emerald"),
    ).toBe(false);
    await rcon.command("difficulty peaceful");
  });

  test("a distant horde pursues players and a solo run has one self revive", async ({
    bot,
    rcon,
  }) => {
    const joined = waitForMessage(bot, /Survival: Fighter/u);
    bot.chat("/arena join settlement");
    await joined;
    await rcon.command("difficulty normal");
    const round = waitForMessage(bot, /Round 1:/u);
    await rcon.command("arena start settlement");
    await round;
    await rcon.command(`tp ${bot.username} 1774.5 73 2166.5`);
    await waitUntil(
      "horde becomes visible",
      () =>
        Object.values(bot.entities).some(
          (e) => e.name === "zombie" || e.name === "husk",
        ),
      30_000,
    );
    await waitUntil(
      "horde closes the distance",
      () =>
        Object.values(bot.entities).some(
          (e) =>
            (e.name === "zombie" || e.name === "husk") &&
            e.position.distanceTo(bot.entity.position) < 8,
        ),
      45_000,
    );
    const revived = waitForMessage(bot, /one self-revive was used/u);
    await rcon.command(`damage ${bot.username} 100 minecraft:generic`);
    await revived;
    await rcon.command(
      `effect give ${bot.username} minecraft:instant_damage 1 5`,
    );
    await waitUntil(
      "solo wipe restores player",
      () => bot.inventory.items().every((i) => i.name !== "stone_sword"),
      15_000,
    );
    await rcon.command("arena stop settlement");
    await rcon.command("difficulty peaceful");
  });
});

describe("cooperative survival and bosses on real Paper", () => {
  test("teammates revive, trade run resources, and receive credited emerald items", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    for (const player of [bot, secondBot]) {
      const joined = waitForMessage(player, /Survival: Fighter/u);
      player.chat("/arena join settlement");
      await joined;
    }
    await rcon.command("difficulty normal");
    const round = waitForMessage(bot, /Round 1:/u);
    await rcon.command("arena start settlement");
    await round;
    await rcon.command(`tp ${bot.username} 1774.5 73 2166.5`);
    await rcon.command(`tp ${secondBot.username} 1776.5 73 2166.5`);
    const downed = waitForMessage(bot, /Downed!/u);
    await rcon.command(`damage ${bot.username} 100 minecraft:generic`);
    await downed;
    const revived = waitForMessage(bot, /You were revived/u);
    secondBot.setControlState("sneak", true);
    await revived;
    secondBot.setControlState("sneak", false);
    expect(bot.health).toBeGreaterThan(1);

    await waitUntil(
      "zombie in range",
      () =>
        Object.values(bot.entities).some(
          (e) => e.name === "zombie" || e.name === "husk",
        ),
      20_000,
    );
    // The imported world also contains ordinary mobs. Credit only an entity
    // tagged by the arena, rather than the first zombie the client can see.
    const damage = await rcon.command(
      `damage @e[type=minecraft:zombie,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},x=1712,y=62,z=2128,dx=159,dy=48,dz=159,limit=1] 100 minecraft:player_attack by ${bot.username}`,
    );
    expect(damage).toMatch(/Applied .* damage/u);
    await waitUntil("credited emerald currency", () =>
      bot.inventory.items().some((i) => i.name === "emerald" && i.count === 2),
    );
    const donation = waitForMessage(bot, /Donated 2 EMERALD/u);
    bot.chat(`/survival give ${secondBot.username} EMERALD 2`);
    await donation;
    await waitUntil("teammate received tagged emeralds", () =>
      secondBot.inventory
        .items()
        .some((i) => i.name === "emerald" && i.count === 2),
    );
    expect(bot.inventory.items().some((i) => i.name === "emerald")).toBe(false);
    for (const player of [bot, secondBot]) player.chat("/arena leave");
    await rcon.command("arena stop settlement");
    await rcon.command("difficulty peaceful");
  });

  test(
    "fifth-round bosses display a cast warning before their spell lands",
    { timeout: 180_000 },
    async ({ bot, rcon }) => {
      const joined = waitForMessage(bot, /Survival: Fighter/u);
      bot.chat("/arena join settlement");
      await joined;
      await rcon.command("difficulty normal");
      await rcon.command(
        `effect give ${bot.username} minecraft:resistance 120 4 true`,
      );
      const first = waitForMessage(bot, /Round 1:/u);
      await rcon.command("arena start settlement");
      await first;
      const messages: string[] = [];
      const listen = (message: string) => {
        messages.push(message);
      };
      bot.on("messagestr", listen);
      try {
        for (let round = 1; round < 5; round++) {
          const next = waitForMessage(
            bot,
            new RegExp(`Round ${(round + 1).toString()}:`, "u"),
            55_000,
          );
          // Opening rounds now deliberately spread their spawns out.
          const deadline = Date.now() + 45_000;
          while (
            !messages.some((m) =>
              m.includes(`Round ${round.toString()} cleared`),
            )
          ) {
            if (Date.now() > deadline)
              throw new Error(`Round ${round.toString()} did not clear`);
            await rcon.command(
              "kill @e[type=!minecraft:player,x=1712,y=62,z=2128,dx=159,dy=48,dz=159]",
            );
            await Bun.sleep(1000);
          }
          await next;
        }
        const cast = await waitForMessage(
          bot,
          /Breeze Sovereign casts WIND_LANES.*Phase 1/u,
          15_000,
        );
        expect(cast.join("\n")).toContain("marked ground");
        await rcon.command(
          `execute at @e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1] run tp ${bot.username} ~ ~ ~4`,
        );
        await waitUntil("boss enters client tracking range", () =>
          Object.values(bot.entities).some((e) => e.name === "breeze"),
        );
        expect(
          Object.values(bot.entities).some((e) => e.name === "breeze"),
        ).toBe(true);
      } finally {
        bot.off("messagestr", listen);
        await rcon.command("arena stop settlement");
        await rcon.command("difficulty peaceful");
      }
    },
  );
});
