import { describe, expect } from "vitest";
import type { Bot } from "mineflayer";
import { test } from "./fixtures.ts";
import { collectMessages, waitForMessage } from "./harness/bot.ts";
import { waitForDecision } from "./harness/decisions.ts";
import { fileTicket } from "./harness/tickets.ts";

/** The shadow FAQ row for a ticket, asserting its full/cut variant. */
async function faqRow(
  bot: Bot,
  ticketId: string,
  variant: "full" | "cut",
): Promise<RegExpExecArray> {
  return waitForDecision(
    bot,
    new RegExp(
      String.raw`#(\d+) ${bot.username} other allow shadow.*ticket #${ticketId}.*starter-kit ${variant}`,
    ),
  );
}

describe("faq", () => {
  test("known questions record a would-reply row", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const ticketId = await fileTicket(bot, "where is my starter kit", "other");
    const row = await faqRow(bot, ticketId, "full");
    expect(Number(row[1] ?? "0")).toBeGreaterThan(0);
  });

  test("third strikes cut the reply", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const first = await fileTicket(bot, "where is my starter kit", "other");
    await faqRow(bot, first, "full");
    const second = await fileTicket(
      bot,
      "where is my starter kit please",
      "other",
    );
    await faqRow(bot, second, "full");
    const third = await fileTicket(bot, "where is my starter kit now", "other");
    const cut = await faqRow(bot, third, "cut");
    expect(Number(cut[1] ?? "0")).toBeGreaterThan(0);
  });

  test("staff can force an answer", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const ticketId = await fileTicket(bot, "someone broke my door", "other");

    bot.chat(`/agent faq ${ticketId} server-rules`);
    await waitForMessage(
      bot,
      new RegExp(
        String.raw`Answered ticket #${ticketId} with FAQ server-rules\.`,
      ),
    );

    bot.chat(`/ticket view ${ticketId}`);
    const shown = await collectMessages(bot, 3000);
    expect(shown.some((line) => line.includes("run /rules to read them"))).toBe(
      true,
    );
    expect(shown.some((line) => line.includes("Storm FAQ: server-rules"))).toBe(
      true,
    );
  });

  test("staff answers report problems", async ({ bot, rcon }) => {
    await rcon.command(`op ${bot.username}`);
    const ticketId = await fileTicket(bot, "someone broke my fence", "other");

    bot.chat(`/agent faq ${ticketId} nope`);
    await waitForMessage(bot, /No FAQ entry nope\./);

    bot.chat(`/agent faq ${ticketId}`);
    await waitForMessage(
      bot,
      new RegExp(String.raw`No FAQ entry matches ticket #${ticketId}\.`),
    );

    bot.chat("/agent faq 999999");
    await waitForMessage(bot, /No ticket #999999\./);
  });
});
