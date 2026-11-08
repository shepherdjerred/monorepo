import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { shopMessages } from "./shop-assertions.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "PikachuPals' historical note blocks",
  () => {
    test("stocks and sells note blocks without displacing music discs", async ({
      bot,
      rcon,
      server,
    }) => {
      const messages = await shopMessages(bot, server);
      await rcon.command("forceload add 155 -123");
      expect(
        await rcon.command(
          'data get block 155 79 -123 PublicBukkitValues."thestorm:shop_id"',
        ),
      ).toMatch(/data: [1-9]\d*L\b/u);
      await rcon.command("scoreboard objectives add legacy_note dummy");
      await rcon.command(
        "execute store result score #notes legacy_note if items block 158 69 -128 container.* minecraft:note_block",
      );
      expect(
        await rcon.command("scoreboard players get #notes legacy_note"),
      ).toContain("16");
      await rcon.command(
        "execute store result score #discs legacy_note if items block 158 69 -128 container.* minecraft:music_disc_11",
      );
      expect(
        await rcon.command("scoreboard players get #discs legacy_note"),
      ).toContain("8");
      await rcon.command(`minecraft:tp ${bot.username} 155.5 79 -121.5`);
      await waitUntil(
        "customer in shop",
        () => Math.abs(bot.entity.position.z + 121.5) < 2,
      );
      await waitUntil(
        "note sign loaded",
        () =>
          bot.blockAt(new Vec3(155, 79, -123))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(155, 79, -123));
      if (sign === null) throw new Error("Note block sign was not loaded");
      const sale = waitForMessage(bot, /You bought .*Note Block.*PikachuPals/i);
      await bot.activateBlock(sign);
      await sale.catch((error: unknown) => {
        throw new Error(
          `Historical note block purchase failed: ${messages.join(" | ")}`,
          { cause: error },
        );
      });
      expect(
        bot.inventory.items().some((item) => item.name === "note_block"),
      ).toBe(true);
    });
  },
);
