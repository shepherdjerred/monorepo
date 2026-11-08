import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "missing")(
  "missing historical shop container",
  () => {
    test("imports the listing when its replacement chest is closed", async ({
      bot,
      rcon,
    }) => {
      await rcon.command(`op ${bot.username}`);
      await waitUntil(
        "shop registry ready",
        async () => {
          const reply = waitForMessage(bot, /You own|Shops are still loading/);
          bot.chat("/shop");
          const match = await reply;
          return match.includes("You own");
        },
        30_000,
      );
      await rcon.command("forceload add 138 -97");
      await rcon.command(`minecraft:tp ${bot.username} 138.5 69 -94.5`);
      await waitUntil(
        "player at shop",
        () => Math.abs(bot.entity.position.x - 138.5) < 2,
      );
      await rcon.command("setblock 138 68 -97 minecraft:chest");
      await waitUntil(
        "replacement chest loaded",
        () => bot.blockAt(new Vec3(138, 68, -97))?.name === "chest",
      );
      const chest = bot.blockAt(new Vec3(138, 68, -97));
      if (chest === null) throw new Error("Missing fixture chest");
      const opened = new Promise<void>((resolve) =>
        bot.once("windowOpen", () => resolve()),
      );
      await bot.activateBlock(chest);
      await opened;
      if (bot.currentWindow === null) throw new Error("Chest did not open");
      await bot.closeWindow(bot.currentWindow);
      await waitUntil(
        "historical sign registered",
        async () => {
          const sign = await rcon.command(
            'data get block 138 69 -97 PublicBukkitValues."thestorm:shop_id"',
          );
          return /data: [1-9]\d*L\b/u.test(sign);
        },
        30_000,
      );
      expect(await rcon.command("data get block 138 68 -97 Items")).toContain(
        "minecraft:iron_ingot",
      );
    });
  },
);
