import { expect } from "vitest";
import { Vec3 } from "vec3";
import { z } from "zod";
import type { Bot } from "mineflayer";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

const Position = z.object({ x: z.number(), y: z.number(), z: z.number() });
const layout = z
  .object({
    zones: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        emeralds: z.number(),
        purchaseSigns: z.array(Position),
        gate: z.array(Position),
        resources: z.array(z.object({ block: Position, material: z.string() })),
        stations: z.array(z.object({ block: Position, type: z.string() })),
      }),
    ),
  })
  .parse(
    Bun.YAML.parse(
      await Bun.file(
        "server/owned/plugins/TheStorm/arena/rustworks.yml",
      ).text(),
    ),
  );

type Position = z.infer<typeof Position>;

async function interact(bot: Bot, rcon: RconClient, at: Position) {
  const beside = new Vec3(at.x + 0.5, at.y, at.z + 1.5);
  await rcon.command(
    `tp ${bot.username} ${beside.x.toString()} ${beside.y.toString()} ${beside.z.toString()}`,
  );
  await waitUntil(
    "Rustworks fixture approach",
    () =>
      bot.entity.position.distanceTo(beside) < 0.7 &&
      bot.blockAt(new Vec3(at.x, at.y, at.z)) !== null,
  );
  const fixture = bot.blockAt(new Vec3(at.x, at.y, at.z));
  if (fixture === null)
    throw new Error("Authored Rustworks fixture was not loaded");
  await bot.activateBlock(fixture);
}

async function enter(
  bot: Bot,
  rcon: RconClient,
  map: string,
  practice: boolean,
) {
  await rcon.command(`op ${bot.username}`);
  const entered = waitForMessage(bot, /Survival: Fighter/u);
  bot.chat(`/arena join ${map}${practice ? " 4" : ""}`);
  await entered;
  const round = waitForMessage(bot, practice ? /Round 4:/u : /Round 1:/u);
  await rcon.command(`arena start ${map}`);
  await round;
  await rcon.command(
    `effect give ${bot.username} minecraft:resistance infinite 255 true`,
  );
}

async function runItems(
  bot: Bot,
  rcon: RconClient,
  material: string,
  count: number,
) {
  const itemData = await rcon.command(
    `data get entity ${bot.username} Inventory[{Slot:0b}].components."minecraft:custom_data".PublicBukkitValues."thestorm:survival_run"`,
  );
  const run = z.guid().parse(/[a-f0-9-]{36}/u.exec(itemData)?.[0]);
  await rcon.command(
    `give ${bot.username} minecraft:${material}[minecraft:custom_data={PublicBukkitValues:{"thestorm:arena_item":1b,"thestorm:survival_run":"${run}"}}] ${count.toString()}`,
  );
}

async function wood(bot: Bot, rcon: RconClient) {
  return z
    .object({ wood: z.number().int().nonnegative() })
    .parse(
      JSON.parse(
        await rcon.command(`storm-fixture-survival bank ${bot.username} 0`),
      ),
    ).wood;
}

test(
  "Rustworks and Settlement run together without sharing banks or stop state",
  { timeout: 75_000 },
  async ({ bot, secondBot, rcon }) => {
    await rcon.command("difficulty normal");
    try {
      await enter(bot, rcon, "rustworks", true);
      await enter(secondBot, rcon, "settlement", true);
      expect(await rcon.command("arena list")).toMatch(
        /rustworks.*fighting, 1 inside/u,
      );
      expect(await rcon.command("arena list")).toMatch(
        /settlement.*fighting, 1 inside/u,
      );
      const refused = waitForMessage(bot, /already in rustworks/u);
      bot.chat("/arena join settlement");
      await refused;
      await rcon.command(`clear ${bot.username} minecraft:oak_planks`);
      await runItems(bot, rcon, "oak_planks", 8);
      const bank = layout.zones
        .flatMap((zone) => zone.stations)
        .find((station) => station.type === "BANK");
      if (bank === undefined)
        throw new Error("Rustworks needs a starting bank");
      await interact(bot, rcon, bank.block);
      await waitUntil("Rustworks bank opens", () => bot.currentWindow !== null);
      await bot.clickWindow(0, 0, 0);
      await waitUntil(
        "Rustworks supplies deposited",
        () => !bot.inventory.items().some((item) => item.name === "oak_planks"),
      );
      if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
      expect(await wood(bot, rcon)).toBe(8);
      expect(await wood(secondBot, rcon)).toBe(0);
      await rcon.command("arena stop rustworks");
      expect(await rcon.command("arena list")).toMatch(
        /settlement.*fighting, 1 inside/u,
      );
      expect(
        await rcon.command(
          `execute positioned 1758.5 73 2271.5 if entity @a[name=${secondBot.username},distance=..8]`,
        ),
      ).toContain("Test passed");
    } finally {
      await rcon.command("arena stop rustworks");
      await rcon.command("arena stop settlement");
      await rcon.command("difficulty peaceful");
    }
  },
);

test(
  "all 22 Rustworks purchases open physical gates and remove their signs",
  { timeout: 180_000 },
  async ({ bot, rcon }) => {
    await rcon.command("difficulty normal");
    try {
      await enter(bot, rcon, "rustworks", false);
      await runItems(bot, rcon, "emerald", 256);
      for (const zone of layout.zones.filter(
        (district) => district.emeralds > 0,
      )) {
        const sign = zone.purchaseSigns[0];
        if (sign === undefined)
          throw new Error(`Missing purchase sign: ${zone.id}`);
        const quote = waitForMessage(bot, /costs \d+ emeralds/u);
        await interact(bot, rcon, sign);
        await quote;
        // Confirmation deliberately rejects duplicate interaction packets within 200ms.
        await Bun.sleep(250);
        const opened = waitForMessage(bot, / opened /u);
        const fixture = bot.blockAt(new Vec3(sign.x, sign.y, sign.z));
        if (fixture === null)
          throw new Error("Purchase sign vanished before confirmation");
        await bot.activateBlock(fixture);
        await opened;
        for (const gate of [zone.gate[0], zone.gate.at(-1)]) {
          if (gate === undefined) throw new Error(`Missing gate: ${zone.id}`);
          expect(
            await rcon.command(
              `execute if block ${gate.x.toString()} ${gate.y.toString()} ${gate.z.toString()} minecraft:air`,
            ),
          ).toBe("Test passed");
        }
        expect(
          await rcon.command(
            `execute if block ${sign.x.toString()} ${sign.y.toString()} ${sign.z.toString()} minecraft:air`,
          ),
        ).toBe("Test passed");
      }
    } finally {
      await rcon.command("arena stop rustworks");
      await rcon.command("difficulty peaceful");
    }
  },
);
