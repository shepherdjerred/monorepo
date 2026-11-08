import { describe } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "recovery")(
  "historical shop startup recovery",
  () => {
    test("closes a completed shop whose chest did not retain its stock marker", async ({
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
      const closed = waitForMessage(
        bot,
        /historical shop world data needs staff reconciliation/,
      );
      bot.chat("/shop");
      await closed;
    });
  },
);
