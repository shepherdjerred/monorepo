import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "Smaland47's historical bows",
  () => {
    test("stocks the seven listings and sells an enchanted bow", async ({
      bot,
      rcon,
      server,
    }) => {
      const messages: string[] = [];
      bot.on("messagestr", (message) => {
        messages.push(message);
      });
      await waitUntil(
        "shop registry ready",
        async () => /Indexed \d+ world shops/.test(await serverLogs(server)),
        60_000,
      );
      await rcon.command("forceload add 33 -152 41 -144");
      for (const [x, y, z] of [
        [33, 64, -151],
        [41, 63, -145],
        [41, 63, -146],
        [41, 64, -145],
        [41, 64, -144],
        [41, 63, -144],
        [41, 64, -146],
      ] as const) {
        expect(
          await rcon.command(
            `data get block ${x.toString()} ${y.toString()} ${z.toString()} PublicBukkitValues."thestorm:shop_id"`,
          ),
        ).toMatch(/data: [1-9]\d*L\b/u);
      }
      await rcon.command("scoreboard objectives add legacy_bows dummy");
      await rcon.command(
        "execute store result score #stock legacy_bows if items block 35 63 -144 container.* minecraft:bow",
      );
      expect(
        await rcon.command("scoreboard players get #stock legacy_bows"),
      ).toContain("24");
      for (const [slot, names] of [
        [4, ["power"]],
        [8, ["flame"]],
        [12, ["unbreaking", "flame", "punch"]],
        [16, ["unbreaking", "power", "punch"]],
        [20, ["unbreaking", "flame", "power"]],
      ] as const) {
        const nbt = await rcon.command(
          `data get block 35 63 -144 Items[{Slot:${slot.toString()}b}].components."minecraft:enchantments"`,
        );
        for (const name of names) expect(nbt).toContain(`minecraft:${name}`);
      }
      await rcon.command(
        "execute store result score #used legacy_bows if items block 33 63 -152 container.* minecraft:bow",
      );
      expect(
        await rcon.command("scoreboard players get #used legacy_bows"),
      ).toContain("4");
      expect(
        await rcon.command(
          'data get block 33 63 -152 Items[{Slot:0b}].components."minecraft:damage"',
        ),
      ).toContain("311");
      expect(
        await rcon.command(
          'data get block 33 63 -152 Items[{Slot:0b}].components."minecraft:enchantments"',
        ),
      ).toContain("minecraft:power");
      await rcon.command(`minecraft:tp ${bot.username} 41.5 63 -143.5`);
      await waitUntil(
        "customer in shop",
        () => Math.abs(bot.entity.position.z + 143.5) < 2,
      );
      await waitUntil(
        "bow sign loaded",
        () =>
          bot.blockAt(new Vec3(41, 63, -145))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(41, 63, -145));
      if (sign === null) throw new Error("Bow sign was not loaded");
      const sale = waitForMessage(bot, /You bought .*Bow.*Smaland47/i);
      await bot.activateBlock(sign);
      await sale.catch((error: unknown) => {
        throw new Error(
          `Historical bow purchase failed: ${messages.join(" | ")}`,
          { cause: error },
        );
      });
      expect(bot.inventory.items().some((item) => item.name === "bow")).toBe(
        true,
      );
    });
  },
);
