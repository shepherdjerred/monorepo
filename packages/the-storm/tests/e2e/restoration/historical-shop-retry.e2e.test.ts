import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitUntil } from "#e2e/harness/bot.ts";
import {
  closeRestorationChest,
  waitForHistoricalShop,
  waitForShopCommand,
} from "./shop-assertions.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "1")(
  "historical shop recovery",
  () => {
    test("stocks a full chest after a player clears and closes it", async ({
      bot,
      rcon,
    }) => {
      await waitForShopCommand(bot);
      await rcon.command(`op ${bot.username}`);
      await rcon.command(`minecraft:tp ${bot.username} 138.5 69 -94.5`);
      await closeRestorationChest(bot, new Vec3(138, 68, -97), () =>
        rcon.command("item replace block 138 68 -97 container.0 with air"),
      );
      await waitUntil(
        "historical shop stocked",
        async () => {
          const contents = await rcon.command(
            "data get block 138 68 -97 Items",
          );
          return contents.includes("minecraft:iron_ingot");
        },
        30_000,
      );
      await waitForHistoricalShop(rcon, 138, 69, -97);
      expect(await rcon.command("data get block 138 68 -97 Items")).toContain(
        "minecraft:iron_ingot",
      );
    });
  },
);
