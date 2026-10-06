import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";
import { travelToRuneforge } from "#e2e/harness/settlement.ts";

async function join(bot: Bot, round?: number) {
  const joined = waitForMessage(bot, /Survival: Fighter/u);
  bot.chat(
    round === undefined
      ? "/arena join settlement"
      : `/arena join settlement ${round.toString()}`,
  );
  await joined;
}

async function start(bot: Bot, rcon: RconClient, round: number) {
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

async function clickBox(bot: Bot) {
  const block = bot.blockAt(new Vec3(1790, 73, 2270));
  if (block === null) throw new Error("Market box missing");
  await bot.activateBlock(block);
}

async function menu(bot: Bot, command: string) {
  bot.chat(command);
  await waitUntil("class window", () => bot.currentWindow !== null);
}

describe("run class builds on real Paper", () => {
  for (const [role, paths] of [
    ["fighter", ["GUARDIAN", "VANGUARD"]],
    ["ranger", ["MARKSMAN", "PIERCER"]],
    ["medic", ["FIELD_SURGEON", "RESCUER"]],
    ["engineer", ["FORTIFIER", "SAPPER"]],
    ["alchemist", ["CRYOMANCER", "PLAGUE_BREWER"]],
    ["beastmaster", ["PACKLEADER", "WARDEN"]],
  ] satisfies [string, string[]][]) {
    for (const [index, path] of paths.entries()) {
      test(`${role} chooses ${path}, upgrades and activates with its compass`, async ({
        bot,
        secondBot,
        rcon,
      }) => {
        await rcon.command(`op ${bot.username}`);
        await join(bot, 15);
        await join(secondBot);
        expect(
          await rcon.command(
            `storm-fixture-survival unlock ${bot.username} none`,
          ),
        ).toContain("Unlocked test class progression");
        const selected = waitForMessage(
          bot,
          new RegExp(`Selected ${role.toUpperCase()}`, "u"),
        );
        bot.chat(`/arena class ${role}`);
        await selected;
        try {
          await start(bot, rcon, 15);
          await rcon.command(
            `effect give ${secondBot.username} minecraft:resistance infinite 255 true`,
          );
          await rcon.command(`tp ${bot.username} 1758.5 73 2271.5`);
          await rcon.command(`tp ${secondBot.username} 1760.5 73 2271.5`);
          await menu(bot, "/survival upgrades");
          await bot.clickWindow(index, 0, 0);
          await waitUntil(
            "Potency choice",
            () => bot.currentWindow?.slots[0]?.name === "glowstone_dust",
          );
          const previousWindow = bot.currentWindow?.id;
          await bot.clickWindow(0, 0, 0);
          await waitUntil(
            "Potency applied",
            () =>
              bot.currentWindow !== null &&
              bot.currentWindow.id !== previousWindow,
          );
          await bot.clickWindow(1, 0, 0);
          await waitUntil(
            "build complete",
            () => bot.currentWindow?.slots[0]?.name === "book",
          );
          if (bot.currentWindow !== null)
            await bot.closeWindow(bot.currentWindow);
          const build = await rcon.command(
            `storm-fixture-survival inspect ${bot.username} none`,
          );
          expect(build).toContain(path);
          expect(build).toContain("potency=1 tempo=1 pending=0");
          if (path === "RESCUER") {
            await rcon.command(
              `effect clear ${secondBot.username} minecraft:resistance`,
            );
            const downed = waitForMessage(secondBot, /Downed!/u);
            await rcon.command(
              `damage ${secondBot.username} 100 minecraft:generic`,
            );
            await downed;
          }
          bot.setQuickBarSlot(8);
          const used = waitForMessage(
            bot,
            /Ability used · 34 second recharge/u,
          );
          bot.activateItem();
          await used;
          if (path === "RESCUER") {
            expect(
              await rcon.command(
                `execute positioned 1758.5 73 2271.5 if entity @a[name=${bot.username},distance=..3]`,
              ),
            ).toBe("Test passed. Count: 1");
          }
          const active = await rcon.command(
            `storm-fixture-survival inspect ${bot.username} none`,
          );
          expect(active).toMatch(/Ability 3[0-4]s/u);
          if (path === "GUARDIAN" || path === "WARDEN") {
            expect(
              await rcon.command(
                `data get entity ${bot.username} AbsorptionAmount`,
              ),
            ).toContain("10.0f");
          }
          if (path === "RESCUER")
            await waitUntil(
              "revived health packet",
              () => secondBot.health > 1,
            );
        } finally {
          await rcon.command("arena stop settlement");
          await rcon.command("difficulty peaceful");
        }
      }, 60_000);
    }
  }
});

describe("animated runic cache on real Paper", () => {
  test("rolls reserve the buyer, reveal after three seconds, relocate after six claims and refund expiry", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await join(bot, 15);
    await join(secondBot);
    try {
      await start(bot, rcon, 15);
      await rcon.command(
        `effect give ${secondBot.username} minecraft:resistance infinite 255 true`,
      );
      await rcon.command(`tp ${bot.username} 1790.5 73 2272.5`);
      await rcon.command(`tp ${secondBot.username} 1792.5 73 2272.5`);
      await waitUntil(
        "market box tracking",
        () => bot.blockAt(new Vec3(1790, 73, 2270)) !== null,
      );
      const data = await rcon.command(
        `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
      );
      const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(data)?.[0]);
      await rcon.command(
        `give ${bot.username} minecraft:emerald[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] 128`,
      );
      const count = async () =>
        await rcon.command(`clear ${bot.username} minecraft:emerald 0`);
      const before = await count();
      const rolling = waitForMessage(bot, /Runic cache rolling/u);
      await clickBox(bot);
      await rolling;
      const reserved = waitForMessage(
        secondBot,
        /belongs to another survivor/u,
      );
      await clickBox(secondBot);
      await reserved;
      expect(
        await rcon.command(
          'execute if entity @e[type=minecraft:item_display,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}]',
        ),
      ).toBe("Test passed. Count: 1");
      const refund = waitForMessage(bot, /16 emeralds refunded/u, 25_000);
      await refund;
      expect(await count()).toBe(before);
      for (let claim = 0; claim < 6; claim++) {
        const nextRoll = waitForMessage(bot, /Runic cache rolling/u);
        await clickBox(bot);
        await nextRoll;
        await Bun.sleep(3100);
        const reward = waitForMessage(bot, /Runic cache reward:/u);
        await clickBox(bot);
        await reward;
      }
      expect(
        await rcon.command(
          `storm-fixture-survival inspect ${bot.username} none`,
        ),
      ).not.toContain("box=market");
      expect(
        await rcon.command("execute if block 1790 79 2270 minecraft:air"),
      ).toBe("Test passed");
      expect(
        await rcon.command(
          'execute if entity @e[type=minecraft:item_display,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}}]',
        ),
      ).toBe("Test failed");
    } finally {
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 100_000);
});

describe("vertical settlement pursuit and party scaling on real Paper", () => {
  const pursuitLegMs = 45_000;
  for (const round of [1, 5, 10, 15]) {
    for (const count of [1, 4]) {
      // Each teammate can spend 20s connecting and 10s joining; also reserve
      // the initial join, round start, and both client arrival waits (10s each).
      const setupBudgetMs = 40_000 + (count - 1) * 30_000;
      const pursuitCaseMs = 3 * pursuitLegMs + setupBudgetMs;
      test(
        `round ${round.toString()} pursues ${count.toString()} survivors across elevated terrain`,
        async ({ bot, server, rcon }) => {
          const teammates: Bot[] = [];
          await rcon.command(`op ${bot.username}`);
          await join(bot, round);
          try {
            for (let index = 1; index < count; index++) {
              const teammate = await connectBot({
                host: server.host,
                port: server.gamePort,
                username: `v${index.toString()}_${bot.username.slice(2)}`,
              });
              teammates.push(teammate);
              await join(teammate);
            }
            await start(bot, rcon, round);
            expect(
              await rcon.command(
                `storm-fixture-survival terrain ${bot.username} none`,
              ),
            ).toContain("Opened test terrain routes");
            for (const player of [bot, ...teammates]) {
              await rcon.command(
                `effect give ${player.username} minecraft:resistance infinite 255 true`,
              );
              await rcon.command(`tp ${player.username} 1844.5 105 2177.5`);
            }
            await waitUntil(
              "upper terrace arrival",
              () => bot.entity.position.y > 104 && bot.entity.position.z > 2176,
            );
            const upperHorde = () =>
              Object.values(bot.entities).filter(
                (entity) =>
                  (entity.name === "zombie" || entity.name === "husk") &&
                  entity.position.y > 102 &&
                  entity.position.distanceTo(bot.entity.position) < 7,
              );
            await waitUntil(
              "horde traverses bluff routes",
              () => upperHorde().length > 0,
              pursuitLegMs,
            );
            // UUIDs survive the client unloading and reloading the distant horde.
            const upperCohort = new Set(
              upperHorde().map((entity) => z.guid().parse(entity.uuid)),
            );
            for (const player of [bot, ...teammates])
              await rcon.command(`tp ${player.username} 1819.5 73 2273.5`);
            await waitUntil(
              "lower wharf arrival",
              () => bot.entity.position.y < 74 && bot.entity.position.x > 1818,
            );
            // The expanded map has two stair legs between its three terraces.
            await waitUntil(
              "the upper horde descends to the middle terrace",
              () =>
                Object.values(bot.entities).some(
                  (entity) =>
                    entity.uuid !== undefined &&
                    upperCohort.has(entity.uuid) &&
                    entity.position.y > 87 &&
                    entity.position.y < 91,
                ),
              pursuitLegMs,
            );
            await waitUntil(
              "horde traverses dock routes",
              () =>
                Object.values(bot.entities).some(
                  (entity) =>
                    (entity.name === "zombie" || entity.name === "husk") &&
                    entity.position.y < 75 &&
                    entity.position.distanceTo(bot.entity.position) < 7,
                ),
              pursuitLegMs,
            );
            expect(bot.health).toBeGreaterThan(0);
          } finally {
            await rcon.command("arena stop settlement");
            await rcon.command("difficulty peaceful");
            for (const teammate of teammates) await disconnectBot(teammate);
          }
        },
        pursuitCaseMs,
      );
    }
  }
});

async function upgradeMessage(bot: Bot, rcon: RconClient) {
  try {
    return await waitForMessage(bot, /Runeforge augmentation 1/u);
  } catch (error) {
    throw new Error(
      `Forge at ${bot.entity.position.toString()}, held ${String(bot.heldItem?.name)}, selected ${bot.quickBarSlot.toString()}, ${await rcon.command(`storm-fixture-survival inspect ${bot.username} none`)}: ${String(error)}`,
      { cause: error },
    );
  }
}

async function upgradeLegendary(
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
  await waitUntil("legendary delivered", () =>
    bot.inventory.items().some((item) => item.name === material),
  );
  const weapon = bot.inventory.items().find((item) => item.name === material);
  if (weapon === undefined) throw new Error("Legendary item missing");
  await bot.equip(weapon, "hand");
  await waitUntil(
    "forge loaded",
    () => bot.blockAt(new Vec3(1727, 73, 2209)) !== null,
  );
  const forge = bot.blockAt(new Vec3(1727, 73, 2209));
  if (forge === null) throw new Error("Forge missing");
  const upgraded = upgradeMessage(bot, rcon);
  await bot.activateBlock(forge);
  await waitUntil("equipment selection", () => bot.currentWindow !== null);
  const previous = bot.currentWindow?.id;
  await bot.clickWindow(0, 0, 0);
  await upgraded;
  await waitUntil(
    "refreshed forge choices",
    () => bot.currentWindow !== null && bot.currentWindow.id !== previous,
  );
  if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
  const metadata = await rcon.command(
    `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_legendary"`,
  );
  expect(metadata).toContain(id);
  expect(
    await rcon.command(
      `data get entity ${bot.username} SelectedItem.components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_upgrade"`,
    ),
  ).toMatch(/: 1$/u);
}

async function legendaryEffects(bot: Bot, rcon: RconClient) {
  await rcon.command(`give ${bot.username} minecraft:arrow 32`);
  await waitUntil("legendary ammunition delivered", () =>
    bot.inventory.items().some((item) => item.name === "arrow"),
  );
  const primary = '@e[type=minecraft:zombie,name="Legendary target 1",limit=1]';
  const secondary =
    '@e[type=minecraft:zombie,name="Legendary target 0",limit=1]';
  for (const material of ["bow", "crossbow"]) {
    const weapon = bot.inventory.items().find((item) => item.name === material);
    if (weapon === undefined)
      throw new Error("Legendary projectile weapon missing");
    await bot.equip(weapon, "hand");
    await bot.lookAt(new Vec3(1811.5, 106.3, 2167.5));
    bot.activateItem();
    await bot.waitForTicks(28);
    bot.deactivateItem();
    if (material === "crossbow") bot.activateItem();
    await bot.waitForTicks(8);
    expect(
      await rcon.command(`data get entity ${primary} Health`),
      `Native ${material} hit; bot at ${bot.entity.position.toString()}; ${await rcon.command("data get entity @e[type=minecraft:arrow,limit=1,sort=nearest] Pos")}`,
    ).not.toContain(": 100.0f");
    if (material === "bow") {
      const health = await rcon.command(`data get entity ${secondary} Health`);
      const number = z.coerce.number().parse(/: ([\d.]+)f/u.exec(health)?.[1]);
      expect(number).toBeLessThan(100);
    } else
      expect(
        await rcon.command(`data get entity ${primary} active_effects`),
      ).toContain("minecraft:slowness");
  }
}

describe("legendary gear and local feedback on real Paper", () => {
  test("all legendary identities survive Runeforge and Graviton consumes ammunition once per recharge", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await join(bot, 15);
    const sounds: string[] = [];
    const heard = (packet: unknown) => {
      sounds.push(JSON.stringify(packet));
    };
    bot._client.on("sound_effect", heard);
    try {
      await start(bot, rcon, 15);
      await travelToRuneforge(bot, rcon);
      await rcon.command(`tp ${bot.username} 1727.5 73 2211.5`);
      for (const [id, material] of [
        ["STORMCALLER", "bow"],
        ["FROSTBITE", "crossbow"],
        ["GRAVITON", "blaze_rod"],
      ] satisfies [string, string][]) {
        await upgradeLegendary(bot, rcon, id, material);
      }
      const rod = bot.inventory
        .items()
        .find((item) => item.name === "blaze_rod");
      if (rod === undefined) throw new Error("Graviton missing");
      await bot.equip(rod, "hand");
      await rcon.command(`tp ${bot.username} 1727.5 73 2224.5`);
      const returnStation = bot.blockAt(new Vec3(1727, 73, 2225));
      if (returnStation === null) throw new Error("Return station missing");
      const returned = waitForMessage(bot, /Back at the fortress/u, 15_000);
      await bot.activateBlock(returnStation);
      await returned;
      await rcon.command(`tp ${bot.username} 1815.5 105 2167.5`);
      expect(
        await rcon.command(
          `storm-fixture-survival targets ${bot.username} none`,
        ),
      ).toContain("three native legendary targets");
      await waitUntil("legendary target tracked", () =>
        Object.values(bot.entities).some(
          (entity) =>
            entity.name === "zombie" &&
            entity.position.distanceTo(new Vec3(1811.5, 105, 2167.5)) < 1,
        ),
      );
      await legendaryEffects(bot, rcon);
      await bot.equip(rod, "hand");
      await bot.lookAt(new Vec3(1811.5, 104.5, 2167.5));
      const before = bot.inventory
        .items()
        .filter((item) => item.name === "redstone")
        .reduce((total, item) => total + item.count, 0);
      bot.activateItem();
      await waitUntil(
        "one redstone spent",
        () =>
          bot.inventory
            .items()
            .filter((item) => item.name === "redstone")
            .reduce((total, item) => total + item.count, 0) ===
          before - 1,
      );
      bot.activateItem();
      await bot.waitForTicks(3);
      expect(
        bot.inventory
          .items()
          .filter((item) => item.name === "redstone")
          .reduce((total, item) => total + item.count, 0),
      ).toBe(before - 1);
      expect(
        sounds.some((sound) => sound.includes("amethyst_block.chime")),
      ).toBe(true);
    } finally {
      bot._client.off("sound_effect", heard);
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  }, 60_000);
});
