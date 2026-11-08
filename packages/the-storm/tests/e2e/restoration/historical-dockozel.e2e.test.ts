import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "Dockozel's historical shop",
  () => {
    test("imports every listing and sells from the stocked cellar", async ({
      bot,
      rcon,
      server,
    }) => {
      await waitUntil(
        "shop registry ready",
        async () => {
          const logs = await serverLogs(server);
          return logs.includes("Completed reviewed legacy shop conversion");
        },
        30_000,
      );
      await rcon.command(
        "execute in minecraft:map2 run forceload add -72 -97 -64 -93",
      );
      const coordinates = [
        [-72, -97],
        [-71, -97],
        [-70, -97],
        [-69, -97],
        [-68, -97],
        [-67, -97],
        [-66, -97],
        [-65, -97],
        [-64, -97],
        [-70, -93],
        [-69, -93],
        [-67, -93],
        [-68, -93],
        [-66, -93],
        [-65, -93],
        [-64, -93],
      ] as const;
      for (const [x, z] of coordinates) {
        const sign = await rcon.command(
          `execute in minecraft:map2 run data get block ${x.toString()} 69 ${z.toString()} PublicBukkitValues."thestorm:shop_id"`,
        );
        expect(sign, `shop sign ${x.toString()},69,${z.toString()}`).toMatch(
          /data: [1-9]\d*L\b/u,
        );
      }
      await rcon.command("scoreboard objectives add historical_stock dummy");
      const stock = [
        [-70, -96, "diamond", 24],
        [-70, -96, "coal", 128],
        [-70, -96, "gold_ingot", 32],
        [-70, -96, "iron_ingot", 32],
        [-68, -96, "packed_ice", 64],
        [-68, -96, "pumpkin", 128],
        [-68, -96, "mutton", 128],
        [-70, -94, "sea_lantern", 16],
        [-68, -96, "cobweb", 16],
        [-68, -94, "cooked_beef", 128],
        [-66, -96, "netherrack", 512],
        [-66, -96, "cobblestone", 1024],
        [-64, -96, "rail", 64],
        [-64, -96, "stone", 512],
        [-64, -96, "prismarine", 64],
        [-70, -94, "prismarine_bricks", 64],
      ] as const;
      for (const [x, z, item, quantity] of stock) {
        await rcon.command(
          `execute in minecraft:map2 store result score #stock historical_stock if items block ${x.toString()} 64 ${z.toString()} container.* minecraft:${item}`,
        );
        const result = await rcon.command(
          "scoreboard players get #stock historical_stock",
        );
        expect(result.split(" has ")[1]?.split(" ")[0], item).toBe(
          quantity.toString(),
        );
      }
      await rcon.command(
        `execute in minecraft:map2 run minecraft:tp ${bot.username} -70.5 69 -95.5`,
      );
      await waitUntil(
        "customer in shop",
        () => Math.abs(bot.entity.position.x + 70.5) < 2,
      );
      await waitUntil(
        "diamond sign loaded",
        () =>
          bot.blockAt(new Vec3(-72, 69, -97))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(-72, 69, -97));
      if (sign === null) throw new Error("Diamond sign was not loaded");
      const sale = waitForMessage(bot, /You bought .*Diamond.*dockozel/i);
      await bot.activateBlock(sign);
      await sale;
      expect(
        bot.inventory.items().some((item) => item.name === "diamond"),
      ).toBe(true);
    });
  },
);
