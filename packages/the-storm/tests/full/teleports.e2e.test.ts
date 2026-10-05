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
  test("free starter RTP records usage and blocks switching to every other travel command", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`tp ${bot.username} 800.5 -60 800.5`);
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
    await command(bot, "/tpinfo rtp", /You have used 1\.0/u);
    const balance = await command(bot, "/balance", /500.*crystals/iu);
    expect(balance).toMatch(/500/u);
    for (const text of [
      "/spawn",
      "/home",
      "/back",
      "/warp travel-proof",
      "/rtp wilds",
    ]) {
      const refusal = await command(
        bot,
        text,
        /All travel commands share this cooldown.*\/tpinfo/u,
      );
      expect(refusal).toContain("/tpinfo");
    }
    for (const text of ["tpa", "tpahere"]) {
      await command(bot, `/${text} ${secondBot.username}`, /Request sent/u);
      const refusal = waitForMessage(
        bot,
        /All travel commands share this cooldown/u,
      );
      secondBot.chat(`/tpaccept ${bot.username}`);
      await refusal;
      if (text === "tpa") await bot.waitForTicks(210);
    }
    await command(bot, "/tpinfo rtp", /You have used 1\.0/u);
    await command(bot, "/balance", /500.*crystals/iu);
  }, 75_000);

  test("both TPA directions charge the requester and jointly escalate the next home", async ({
    bot,
    secondBot,
  }) => {
    await command(bot, `/tpa ${secondBot.username}`, /Request sent/u);
    const first = waitForMessage(bot, /Teleported to/u);
    secondBot.chat(`/tpaccept ${bot.username}`);
    await first;
    await command(bot, "/tpinfo home", /You have used 2\.0/u);
    await command(secondBot, "/tpinfo home", /You have used 0\.0/u);
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
    await command(bot, "/tpinfo home", /now 50 crystals \/ 2m/u);
    await command(secondBot, "/tpinfo home", /You have used 0\.0/u);
  }, 100_000);

  test("help and unanswered requests leave prices, cooldown and allowance unchanged", async ({
    bot,
    secondBot,
  }) => {
    await command(bot, "/tpinfo", /Shared cooldown: ready/u);
    await command(bot, "/tpinfo tpahere", /requester pays/u);
    await command(bot, `/tpa ${secondBot.username}`, /Request sent/u);
    await command(bot, "/tpinfo home", /You have used 0\.0/u);
    await command(bot, "/balance", /500.*crystals/iu);
    await command(secondBot, "/tpdeny", /Request denied/u);
    await command(bot, "/tpinfo home", /Shared cooldown: ready/u);
    await command(bot, "/spawn", /Teleported to spawn/u);
    await command(bot, "/balance", /490.*crystals/iu);
  });
});
