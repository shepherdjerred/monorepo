import type { Bot } from "mineflayer";
import { waitForMessage } from "./bot.ts";

/** Files a ticket and resolves with its id, failing when no id parses. */
export async function fileTicket(
  bot: Bot,
  summary: string,
  category: string,
): Promise<string> {
  bot.chat(`/ticket ${category} ${summary}`);
  const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
  const id = opened[1] ?? "0";
  if (Number(id) <= 0) {
    throw new Error(`${bot.username} filed a ticket with no id`);
  }
  return id;
}
