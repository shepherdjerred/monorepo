import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import {
  closeRestorationChest,
  waitForHistoricalShop,
  visitIronListing,
} from "./shop-assertions.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "missing")(
  "missing historical shop container",
  () => {
    test("imports the listing when its replacement chest is closed", async ({
      bot,
      rcon,
    }) => {
      await visitIronListing(bot, rcon);
      await rcon.command("setblock 138 68 -97 minecraft:chest");
      await closeRestorationChest(bot, new Vec3(138, 68, -97));
      await waitForHistoricalShop(rcon, 138, 69, -97);
      expect(await rcon.command("data get block 138 68 -97 Items")).toContain(
        "minecraft:iron_ingot",
      );
    });
  },
);
