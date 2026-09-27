import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { waitForMessage } from "./harness/bot.ts";
import { waitForDecision } from "./harness/decisions.ts";

describe("agent", () => {
  test("filing a ticket records a shadow triage decision", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    bot.chat("/ticket grief someone broke my wall");
    const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
    const id = opened[1] ?? "0";
    expect(Number(id)).toBeGreaterThan(0);

    const row = await waitForDecision(
      bot,
      /other escalate shadow.*ticket #(\d+)/,
    );
    expect(row[1]).toBe(id);
  });

  test("chat bursts record a shadow mute decision", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    for (let i = 1; i <= 6; i += 1) {
      bot.chat(`burst message ${i.toString()}`);
    }

    await waitForDecision(bot, /spam mute shadow.*rung=0/);
  });
});
