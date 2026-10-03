import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

const at = (x: number, y: number, z: number) => new Vec3(x + 1200, y, z + 1616);

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
      x += 1200;
      z += 1616;
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
    await travel(564.5, 526.5);
    await gather(at(562, 73, 524));
    await waitUntil("first wood harvest", () =>
      bot.inventory
        .items()
        .some((i) => i.name === "oak_planks" && i.count === 4),
    );
    await gather(at(562, 73, 524));
    await waitUntil("second wood harvest", () =>
      bot.inventory
        .items()
        .some((i) => i.name === "oak_planks" && i.count === 8),
    );
    const depleted = waitForMessage(bot, /Depleted for you this round/u);
    await gather(at(562, 73, 524));
    await depleted;
    await travel(578.5, 574.5);
    await gather(at(580, 73, 576));
    await waitUntil("stone harvest", () =>
      bot.inventory
        .items()
        .some((i) => i.name === "cobblestone" && i.count === 4),
    );
    await travel(562.5, 526.5);
    const station = bot.blockAt(at(560, 73, 524));
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
      `damage @e[nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},x=1712,y=62,z=2128,dx=159,dy=48,dz=159,limit=1] 100 minecraft:player_attack by ${bot.username}`,
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
    { timeout: 120_000 },
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
            25_000,
          );
          const deadline = Date.now() + 20_000;
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
