import { describe } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage } from "#e2e/harness/bot.ts";
import { waitForShopCommand } from "./shop-assertions.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "recovery")(
  "historical shop startup recovery",
  () => {
    test("closes a completed shop whose chest did not retain its stock marker", async ({
      bot,
      rcon,
    }) => {
      await rcon.command(`op ${bot.username}`);
      await waitForShopCommand(bot);
      const closed = waitForMessage(
        bot,
        /historical shop world data needs staff reconciliation/,
      );
      bot.chat("/shop");
      await closed;
    });
  },
);
