import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { collectMessages, waitForMessage } from "./harness/bot.ts";
import { triageRow, waitForDecision } from "./harness/decisions.ts";
import { fileTicket } from "./harness/tickets.ts";

describe("escalations", () => {
  test("/escalations shows triage escalations", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const ticketId = await fileTicket(bot, "someone broke my wall", "grief");
    const row = await triageRow(bot, ticketId);

    bot.chat("/escalations");
    const queued = await waitForMessage(
      bot,
      new RegExp(`#${row[1] ?? "0"} .*ticket #${ticketId}`),
    );
    expect(queued[0]).toContain(`ticket #${ticketId}`);
  });

  test("overturn dismisses a queue row", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const ticketId = await fileTicket(bot, "someone broke my fence", "grief");
    const row = await triageRow(bot, ticketId);
    const decisionId = row[1] ?? "0";

    bot.chat(`/agent overturn ${decisionId}`);
    await waitForMessage(
      bot,
      new RegExp(String.raw`Decision #${decisionId} dismissed\.`),
    );

    const marked = await waitForDecision(
      bot,
      new RegExp(`#${decisionId} .*overturned`),
    );
    expect(marked[0]).toContain("overturned");

    bot.chat("/escalations");
    const queue = await collectMessages(bot, 4000);
    expect(queue.some((line) => line.includes("Open escalations"))).toBe(true);
    expect(queue.some((line) => line.includes(`#${decisionId} `))).toBe(false);
  });

  test("sampled decisions surface for spot-check", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    for (let i = 1; i <= 6; i += 1) {
      bot.chat(`sample burst ${i.toString()}`);
    }
    const row = await waitForDecision(
      bot,
      new RegExp(String.raw`#(\d+) ${bot.username} spam mute shadow.*rung=0`),
    );
    const decisionId = row[1] ?? "0";

    bot.chat("/escalations");
    const queue = await collectMessages(bot, 4000);
    expect(queue.some((line) => line.includes("Spot-checks"))).toBe(true);
    expect(queue.some((line) => line.includes("on survival"))).toBe(true);
    expect(queue.some((line) => line.includes(`#${decisionId} `))).toBe(true);
  });

  test("endorse clears a sampled row", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    for (let i = 1; i <= 6; i += 1) {
      bot.chat(`endorse burst ${i.toString()}`);
    }
    const row = await waitForDecision(
      bot,
      new RegExp(String.raw`#(\d+) ${bot.username} spam mute shadow.*rung=0`),
    );
    const decisionId = row[1] ?? "0";

    bot.chat(`/agent endorse ${decisionId}`);
    await waitForMessage(
      bot,
      new RegExp(
        String.raw`Decision #${decisionId} endorsed and cleared from review\.`,
      ),
    );

    const marked = await waitForDecision(
      bot,
      new RegExp(`#${decisionId} .*endorsed`),
    );
    expect(marked[0]).toContain("endorsed");

    bot.chat("/escalations");
    const queue = await collectMessages(bot, 4000);
    expect(queue.some((line) => line.includes(`#${decisionId} `))).toBe(false);
  });

  test("/agent case assembles the ticket", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const ticketId = await fileTicket(bot, "someone broke my door", "grief");
    await triageRow(bot, ticketId);

    bot.chat(`/agent case ${ticketId}`);
    const lines = await collectMessages(bot, 3000);
    const shown = (pattern: RegExp) => lines.some((line) => pattern.test(line));
    expect(
      shown(new RegExp(String.raw`Ticket #${ticketId} \[grief\] open`)),
    ).toBe(true);
    expect(shown(/Standing: not banned/)).toBe(true);
    expect(shown(/Agent trail:/)).toBe(true);
  });
});
