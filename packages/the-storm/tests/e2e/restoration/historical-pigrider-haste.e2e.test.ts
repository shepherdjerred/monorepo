import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { shopMessages } from "./shop-assertions.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "Pigrider's historical haste potions",
  () => {
    test("preserves the original potions and sells the advertised item", async ({
      bot,
      rcon,
      server,
    }) => {
      const messages = await shopMessages(bot, server);
      await rcon.command("forceload add 141 -96");
      await waitUntil(
        "historical sign restored",
        async () => {
          const data = await rcon.command(
            'data get block 141 69 -96 PublicBukkitValues."thestorm:shop_id"',
          );
          return /data: [1-9]\d*L\b/u.test(data);
        },
        30_000,
      );
      const other =
        'data get block 141 68 -96 Items[{Slot:17b}].components."minecraft:potion_contents".potion';
      expect(await rcon.command(other)).toContain("minecraft:long_weakness");
      const added =
        'data get block 141 68 -96 Items[{Slot:0b}].components."minecraft:potion_contents"';
      expect(await rcon.command(`${added}.custom_effects[0].id`)).toContain(
        "minecraft:haste",
      );
      expect(await rcon.command(`${added}.potion`)).toContain(
        "minecraft:mundane",
      );
      await rcon.command("scoreboard objectives add historical_potions dummy");
      await rcon.command(
        "execute store result score #stock historical_potions if items block 141 68 -96 container.* minecraft:potion",
      );
      expect(
        await rcon.command("scoreboard players get #stock historical_potions"),
      ).toContain("17");
      await rcon.command(`minecraft:tp ${bot.username} 140.5 68 -95.5`);
      await waitUntil(
        "customer in shop",
        () =>
          Math.abs(bot.entity.position.x - 140.5) < 1 &&
          Math.abs(bot.entity.position.z + 95.5) < 1,
      );
      await waitUntil(
        "haste sign loaded",
        () =>
          bot.blockAt(new Vec3(141, 69, -96))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(141, 69, -96));
      if (sign === null) throw new Error("Haste sign was not loaded");
      const sale = waitForMessage(bot, /You bought .*Potion.*Pigrider102/i);
      await bot.activateBlock(sign);
      await sale.catch((error: unknown) => {
        throw new Error(
          `Historical potion purchase failed: ${messages.join(" | ")}`,
          { cause: error },
        );
      });
      expect(bot.inventory.items().some((item) => item.name === "potion")).toBe(
        true,
      );
      expect(await rcon.command(other)).toContain("minecraft:long_weakness");
    });
  },
);
