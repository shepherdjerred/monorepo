import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { waitForMessage } from "./harness/bot.ts";

describe("tickets", () => {
  test("a player files, tracks, and staff resolve a report", async ({
    bot,
    rcon,
  }) => {
    bot.chat("/ticket grief someone broke my wall");
    const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
    const id = opened[1] ?? "0";
    expect(Number(id)).toBeGreaterThan(0);

    bot.chat(`/ticket view ${id}`);
    await waitForMessage(bot, /someone broke my wall/);

    await rcon.command(`op ${bot.username}`);
    bot.chat(`/ticket claim ${id}`);
    await waitForMessage(bot, new RegExp(`Ticket #${id} claimed`));

    bot.chat(`/ticket resolve ${id} rolled back`);
    await waitForMessage(bot, new RegExp(`Ticket #${id} resolved`));
  });

  test("a player cannot see another player's ticket", async ({
    bot,
    secondBot,
  }) => {
    bot.chat("/ticket chat spam in global");
    const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
    const id = opened[1] ?? "0";

    secondBot.chat(`/ticket view ${id}`);
    await waitForMessage(secondBot, /isn't yours/);
  });

  test("a player cannot comment on another player's ticket", async ({
    bot,
    secondBot,
  }) => {
    bot.chat("/ticket grief someone broke my wall");
    const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
    const id = opened[1] ?? "0";

    secondBot.chat(`/ticket comment ${id} I was never there`);
    await waitForMessage(secondBot, /isn't yours/);
  });
});
