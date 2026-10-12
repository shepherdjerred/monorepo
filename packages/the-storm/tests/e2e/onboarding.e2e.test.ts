import { randomBytes } from "node:crypto";
import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import {
  collectMessages,
  connectBot,
  disconnectBot,
  waitForMessage,
} from "./harness/bot.ts";

function username(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

describe("onboarding", () => {
  test("first-joiners are greeted with starter tips", async ({ server }) => {
    const newcomer = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: username("n"),
    });
    try {
      // The greeting lands seconds after the arrival burst; one window
      // catches every line no matter how the packets batch.
      const seen = await collectMessages(newcomer, 8000);
      const shown = (pattern: RegExp) =>
        seen.some((line) => pattern.test(line));
      expect(shown(/Welcome to The Storm/)).toBe(true);
      expect(shown(/starting supplies arrive automatically/)).toBe(true);
      expect(shown(/\/kit\b|You received the .* kit/)).toBe(false);
      expect(shown(/Run \/rules/)).toBe(true);
      expect(shown(/File a ticket/)).toBe(true);
    } finally {
      await disconnectBot(newcomer);
    }
  });

  test("returning players are not greeted again", async ({ server }) => {
    const name = username("r");
    const first = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: name,
    });
    await waitForMessage(first, /Welcome to The Storm/);
    await disconnectBot(first);

    const again = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: name,
    });
    try {
      // Past the greeting delay: silence proves the server remembered.
      const seen = await collectMessages(again, 6000);
      expect(seen.some((line) => line.includes("Welcome to The Storm"))).toBe(
        false,
      );
    } finally {
      await disconnectBot(again);
    }
  });
});
