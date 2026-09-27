import { describe, expect } from "vitest";
import type { Bot } from "mineflayer";
import { test } from "./fixtures.ts";
import { waitForMessage } from "./harness/bot.ts";
import { waitForDecision } from "./harness/decisions.ts";
import { setBrainMode } from "./harness/fake-brain.ts";

/**
 * Claims and resolves every open ticket, so the sweep report counts only what
 * this file filed. Earlier files leave their tickets open; without this the
 * report totals depend on file order.
 */
async function closeAllOpenTickets(bot: Bot): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    bot.chat("/tickets");
    const seen: string[] = [];
    const onMessage = (message: string) => {
      seen.push(message);
    };
    bot.on("messagestr", onMessage);
    await Bun.sleep(2000);
    bot.off("messagestr", onMessage);
    const ids = [
      ...new Set(
        seen.flatMap((line) =>
          [...line.matchAll(/#(\d+) \[open\]/g)].map(
            (match) => match[1] ?? "0",
          ),
        ),
      ),
    ].filter((id) => id !== "0");
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      bot.chat(`/ticket claim ${id}`);
      await waitForMessage(
        bot,
        new RegExp(String.raw`Ticket #${id} claimed\.|already claimed`),
      );
      bot.chat(`/ticket resolve ${id} clearing the queue for the sweep test`);
      await waitForMessage(
        bot,
        new RegExp(String.raw`Ticket #${id} resolved\.`),
      );
    }
  }
  throw new Error("could not clear the ticket queue");
}

/** Runs /agent sweep, retrying when the scheduled tick holds the sweep. */
async function sweepReport(bot: Bot): Promise<RegExpExecArray> {
  let last: unknown = new Error("sweep stayed busy");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    bot.chat("/agent sweep");
    const reply = await waitForMessage(
      bot,
      /Sweep: (\d+) redriven, (\d+) escalated, (\d+) failed|A sweep is already running\./,
      10_000,
    );
    if (reply[0].startsWith("Sweep:")) {
      return reply;
    }
    last = new Error("sweep stayed busy");
    await Bun.sleep(2000);
  }
  throw last;
}

describe("stale-ticket sweep", () => {
  test("/agent sweep redrives a ticket the brain failed", async ({
    bot,
    brain,
    rcon,
  }) => {
    await setBrainMode(brain.port, "down");
    try {
      await rcon.command(`op ${bot.username}`);
      await closeAllOpenTickets(bot);
      bot.chat("/ticket grief someone broke my wall");
      const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
      const id = opened[1] ?? "0";
      expect(Number(id)).toBeGreaterThan(0);

      // The manual sweep attempts the redrive and reports the outage.
      const failed = await sweepReport(bot);
      expect(failed[1]).toBe("0");
      expect(failed[3]).toBe("1");

      await setBrainMode(brain.port, "ok");
      await sweepReport(bot);
      const row = await waitForDecision(
        bot,
        new RegExp(`other escalate shadow.*ticket #${id}`),
      );
      expect(row[0]).toContain(`ticket #${id}`);
    } finally {
      await setBrainMode(brain.port, "ok");
    }
  });

  test(
    "the scheduled sweep redrives without a command",
    { timeout: 120_000 },
    async ({ bot, brain, rcon }) => {
      await setBrainMode(brain.port, "down");
      try {
        await rcon.command(`op ${bot.username}`);
        bot.chat("/ticket grief someone broke my fence");
        const opened = await waitForMessage(bot, /Ticket #(\d+) opened/);
        const id = opened[1] ?? "0";
        expect(Number(id)).toBeGreaterThan(0);

        // Heal the brain and wait for the 60s tick; no /agent sweep.
        await setBrainMode(brain.port, "ok");
        const row = await waitForDecision(
          bot,
          new RegExp(`other escalate shadow.*ticket #${id}`),
          30,
        );
        expect(row[0]).toContain(`ticket #${id}`);
      } finally {
        await setBrainMode(brain.port, "ok");
      }
    },
  );
});
