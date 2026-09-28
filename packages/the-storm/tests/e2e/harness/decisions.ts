import type { Bot } from "mineflayer";
import { waitForMessage } from "./bot.ts";

/** Polls /agent decisions until a row matches, for flows that run asynchronously. */
export async function waitForDecision(
  bot: Bot,
  pattern: RegExp,
  attempts = 10,
): Promise<RegExpExecArray> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    bot.chat("/agent decisions");
    try {
      return await waitForMessage(bot, pattern, 3000);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** The shadow triage row for a ticket, with its decision id. */
export async function triageRow(
  bot: Bot,
  ticketId: string,
): Promise<RegExpExecArray> {
  return waitForDecision(
    bot,
    new RegExp(
      String.raw`#(\d+) \S+ other escalate shadow.*ticket #${ticketId}`,
    ),
  );
}
