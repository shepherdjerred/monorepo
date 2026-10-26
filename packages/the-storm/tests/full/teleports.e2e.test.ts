import { describe, expect } from "vitest";
import type { Bot } from "mineflayer";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

async function command(
  bot: Bot,
  text: string,
  response: RegExp,
  timeout = 15_000,
) {
  const message = waitForMessage(bot, response, timeout);
  bot.chat(text);
  const matched = await message;
  return matched[0];
}

describe("shared player travel on native Paper", () => {
  test("a free wilderness teleport does not charge or block home", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`minecraft:tp ${bot.username} 800.5 -60 800.5`);
    await waitUntil(
      "unclaimed home location",
      () =>
        Math.abs(bot.entity.position.x - 800.5) < 0.5 &&
        Math.abs(bot.entity.position.z - 800.5) < 0.5,
    );
    await command(bot, "/sethome", /Home home/u);
    await rcon.command(`op ${bot.username}`);
    await command(bot, "/setwarp travel-proof", /Warp travel-proof set/u);
    await rcon.command(`deop ${bot.username}`);
    await command(
      bot,
      "/rtp wilds",
      /Teleported to wilderness in wilds/u,
      45_000,
    );
    expect(bot.inventory.items().some((item) => item.name === "compass")).toBe(
      true,
    );
    await command(bot, "/balance", /500.*crystals/iu);
    await command(bot, "/home", /Teleported to home/u);
    await command(bot, "/balance", /475.*crystals/iu);
    await command(bot, "/rtp wilds", /You can teleport again/u);
  }, 75_000);

  test("both TPA directions charge only the requester", async ({
    bot,
    secondBot,
  }) => {
    await command(bot, `/tpa ${secondBot.username}`, /Request sent/u);
    const first = waitForMessage(bot, /Teleported to/u);
    secondBot.chat(`/tpaccept ${bot.username}`);
    await first;
    await command(bot, "/tpinfo home", /25 crystals/u);
    await command(secondBot, "/tpinfo home", /25 crystals/u);
    await command(bot, "/balance", /475.*crystals/iu);
    await command(secondBot, "/balance", /500.*crystals/iu);
    // Exercise the configured real cooldown; no privileged travel exemption.
    await bot.waitForTicks(1220);
    await command(bot, `/tpahere ${secondBot.username}`, /Request sent/u);
    const second = waitForMessage(secondBot, /request completed/u);
    secondBot.chat(`/tpaccept ${bot.username}`);
    await second;
    await command(bot, "/balance", /450.*crystals/iu);
    await command(secondBot, "/balance", /500.*crystals/iu);
    await command(bot, "/tpinfo home", /25 crystals/u);
    await command(secondBot, "/tpinfo home", /25 crystals/u);
  }, 100_000);

  test("help and unanswered requests leave prices, cooldown and allowance unchanged", async ({
    bot,
    secondBot,
  }) => {
    await command(bot, "/tpinfo", /its own price and cooldown/u);
    await command(bot, "/tpinfo tpa", /25 crystals/u);
    await command(bot, `/tpa ${secondBot.username}`, /Request sent/u);
    await command(bot, "/tpinfo home", /25 crystals, 1m, ready/u);
    await command(bot, "/balance", /500.*crystals/iu);
    await command(secondBot, "/tpdeny", /Request denied/u);
    await command(bot, "/tpinfo home", /25 crystals, 1m, ready/u);
    await command(bot, "/spawn", /Teleported to spawn/u);
    await command(bot, "/balance", /490.*crystals/iu);
  });
});
