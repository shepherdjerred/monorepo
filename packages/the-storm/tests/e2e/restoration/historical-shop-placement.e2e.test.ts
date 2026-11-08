import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "placed")(
  "historical shop placement protection",
  () => {
    test("retains the owner's access checks for a player-placed replacement", async ({
      bot,
      rcon,
      server,
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
      await rcon.command(
        `item replace entity ${bot.username} hotbar.0 with minecraft:chest`,
      );
      bot.setQuickBarSlot(0);
      await waitUntil("holding chest", () => bot.heldItem?.name === "chest");
      await waitUntil(
        "chest support loaded",
        () => bot.blockAt(new Vec3(138, 67, -97))?.name === "stone",
      );
      const support = bot.blockAt(new Vec3(138, 67, -97));
      if (support === null) throw new Error("Missing fixture support");
      await bot.placeBlock(support, new Vec3(0, 1, 0));
      await waitUntil("ownership refusal logged", async () => {
        const logs = await serverLogs(server);
        return logs.includes(
          "2015-pigrider-iron skipped: owner cannot open container",
        );
      });
      const logs = await serverLogs(server);
      expect(logs).toMatch(
        /2015-pigrider-iron skipped: owner cannot open container:.*lock/i,
      );
      await rcon.command("setblock 138 68 -95 minecraft:stone");
      await rcon.command(
        `minecraft:tp ${bot.username} 138.5 69 -95.5 facing 138.5 68.3 -96.5`,
      );
      await waitUntil(
        "player facing chest",
        () => Math.abs(bot.entity.position.z + 95.5) < 0.25,
      );
      const unlocked = waitForMessage(bot, /Unlocked/);
      bot.chat("/unlock");
      await unlocked;
      const chest = bot.blockAt(new Vec3(138, 68, -97));
      if (chest === null) throw new Error("Placed chest is missing");
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
      const contents = await rcon.command("data get block 138 68 -97 Items");
      expect(contents).toContain("minecraft:iron_ingot");
    });
  },
);
