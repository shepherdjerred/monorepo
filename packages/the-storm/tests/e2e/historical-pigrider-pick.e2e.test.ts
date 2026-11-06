import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "./fixtures.ts";
import { waitForMessage, waitUntil } from "./harness/bot.ts";
import { serverLogs } from "./harness/external/files.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "Pigrider's historical pickaxe",
  () => {
    test("stocks and sells an Unbreaking I diamond pickaxe", async ({
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
        async () => /Loaded \d+ shops/.test(await serverLogs(server)),
        60_000,
      );
      await rcon.command("forceload add 131 -95");
      expect(
        await rcon.command("data get block 131 69 -95 PublicBukkitValues"),
      ).toContain("shop_id");
      await rcon.command("scoreboard objectives add historical_picks dummy");
      await rcon.command(
        "execute store result score #stock historical_picks if items block 131 68 -95 container.* minecraft:diamond_pickaxe",
      );
      expect(
        await rcon.command("scoreboard players get #stock historical_picks"),
      ).toContain("8");
      const enchantments = await rcon.command(
        'data get block 131 68 -95 Items[{Slot:0b}].components."minecraft:enchantments"',
      );
      expect(enchantments).toContain("minecraft:unbreaking");
      await rcon.command(`minecraft:tp ${bot.username} 131.5 69 -92.5`);
      await waitUntil(
        "customer in shop",
        () => Math.abs(bot.entity.position.z + 92.5) < 2,
      );
      await waitUntil(
        "pickaxe sign loaded",
        () =>
          bot.blockAt(new Vec3(131, 69, -95))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(131, 69, -95));
      if (sign === null) throw new Error("Pickaxe sign was not loaded");
      const sale = waitForMessage(bot, /You bought .*Pickaxe.*Pigrider102/i);
      await bot.activateBlock(sign);
      await sale.catch((error: unknown) => {
        throw new Error(
          `Historical pickaxe purchase failed: ${messages.join(" | ")}`,
          { cause: error },
        );
      });
      expect(
        bot.inventory.items().some((item) => item.name === "diamond_pickaxe"),
      ).toBe(true);
    });
  },
);
