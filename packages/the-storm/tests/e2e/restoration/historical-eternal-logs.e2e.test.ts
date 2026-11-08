import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, onTestFinished } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { shopMessages } from "./shop-assertions.ts";
import { copyStormDatabase, querySqlite } from "#e2e/harness/storm-data.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "dockozel")(
  "Eternal's historical Minemart",
  () => {
    test("sells the original two-stack dark oak deal", async ({
      bot,
      rcon,
      server,
    }) => {
      const messages = await shopMessages(bot, server);
      await rcon.command("forceload add 113 -169");
      expect(
        await rcon.command(
          'data get block 113 71 -169 PublicBukkitValues."thestorm:shop_id"',
        ),
      ).toMatch(/data: [1-9]\d*L\b/u);
      await rcon.command("scoreboard objectives add legacy_logs dummy");
      await rcon.command(
        "execute store result score #stock legacy_logs if items block 116 70 -166 container.* minecraft:dark_oak_log",
      );
      expect(
        await rcon.command("scoreboard players get #stock legacy_logs"),
      ).toContain("512");
      await rcon.command(`minecraft:tp ${bot.username} 113.5 71 -167.5`);
      await waitUntil(
        "customer in shop",
        () => Math.abs(bot.entity.position.z + 167.5) < 2,
      );
      await waitUntil(
        "log sign loaded",
        () =>
          bot.blockAt(new Vec3(113, 71, -169))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(113, 71, -169));
      if (sign === null) throw new Error("Log sign was not loaded");
      const sale = waitForMessage(
        bot,
        /You bought .*Dark Oak Log.*EternalRegret/i,
      );
      await bot.activateBlock(sign);
      await sale.catch((error: unknown) => {
        throw new Error(
          `Historical log purchase failed: ${messages.join(" | ")}`,
          { cause: error },
        );
      });
      expect(
        bot.inventory
          .items()
          .filter((item) => item.name === "dark_oak_log")
          .reduce((sum, item) => sum + item.count, 0),
      ).toBe(128);
      const directory = await mkdtemp(
        path.join(tmpdir(), "storm-shop-ledger-"),
      );
      onTestFinished(() => rm(directory, { recursive: true, force: true }));
      const database = await copyStormDatabase(server, directory);
      const ledger = await querySqlite(
        database,
        "select from_kind, to_kind, to_id, currency, amount from economy_ledger where to_id = '4ef5998c-d6b3-4779-9da5-9065d3b1a365'",
      );
      expect(ledger).toContainEqual({
        from_kind: "player",
        to_kind: "player",
        to_id: "4ef5998c-d6b3-4779-9da5-9065d3b1a365",
        currency: "crystals",
        amount: 100,
      });
    });
  },
);
