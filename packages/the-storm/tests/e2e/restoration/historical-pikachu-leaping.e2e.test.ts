import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { shopMessages } from "./shop-assertions.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "PikachuPals' historical leaping potions",
  () => {
    test("keeps existing haste potions and sells the stocked leaping potion", async ({
      bot,
      rcon,
      server,
    }) => {
      const messages = await shopMessages(bot, server);
      await rcon.command("forceload add 164 -123");
      expect(
        await rcon.command(
          'data get block 164 96 -123 PublicBukkitValues."thestorm:shop_id"',
        ),
      ).toMatch(/data: [1-9]\d*L\b/u);
      expect(
        await rcon.command(
          'data get block 165 96 -123 Items[{Slot:0b}].components."minecraft:potion_contents".potion',
        ),
      ).toContain("minecraft:leaping");
      await rcon.command("scoreboard objectives add legacy_potions dummy");
      await rcon.command(
        "execute store result score #leaping legacy_potions if items block 165 96 -123 container.* minecraft:potion",
      );
      expect(
        await rcon.command("scoreboard players get #leaping legacy_potions"),
      ).toContain("4");
      await rcon.command(
        "execute store result score #haste legacy_potions if items block 156 91 -117 container.* minecraft:potion",
      );
      expect(
        await rcon.command("scoreboard players get #haste legacy_potions"),
      ).toContain("8");
      await rcon.command(`minecraft:tp ${bot.username} 164.5 96 -121.5`);
      await waitUntil(
        "customer in shop",
        () => Math.abs(bot.entity.position.z + 121.5) < 2,
      );
      await waitUntil(
        "leaping sign loaded",
        () =>
          bot.blockAt(new Vec3(164, 96, -123))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(164, 96, -123));
      if (sign === null) throw new Error("Leaping sign was not loaded");
      const sale = waitForMessage(bot, /You bought .*Potion.*PikachuPals/i);
      await bot.activateBlock(sign);
      await sale.catch((error: unknown) => {
        throw new Error(
          `Historical leaping purchase failed: ${messages.join(" | ")}`,
          { cause: error },
        );
      });
      expect(bot.inventory.items().some((item) => item.name === "potion")).toBe(
        true,
      );
    });
  },
);
