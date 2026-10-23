import { describe, expect, test, vi } from "vitest";
import {
  DiscordGuildIdSchema,
  ExploreMessageSchema,
} from "@scout-for-lol/data";
import { offerVoiceConfirmations } from "#src/voice-assistant/confirmations.ts";

const GUILD = DiscordGuildIdSchema.parse("100000000000000071");
const ANSWER = ExploreMessageSchema.parse({
  id: "00000000-0000-4000-8000-000000000071",
  role: "assistant",
  content: "I prepared the report; confirm it from your DMs.",
  createdAt: "2026-10-22T12:00:00.000Z",
});

describe("offerVoiceConfirmations", () => {
  test("reports a failed delivery instead of throwing", async () => {
    const outcome = await offerVoiceConfirmations({
      deliver: () => Promise.reject(new Error("Discord is down")),
      userId: "900000000000000071",
      answer: ANSWER,
      guildId: GUILD,
    });
    expect(outcome).toBe("not_sent");
  });

  test("passes through what the delivery did", async () => {
    const outcome = await offerVoiceConfirmations({
      deliver: () => Promise.resolve("sent"),
      userId: "900000000000000071",
      answer: ANSWER,
      guildId: GUILD,
    });
    expect(outcome).toBe("sent");
  });

  test("a stalled delivery does not hold the answer", async () => {
    vi.useFakeTimers();
    try {
      const outcome = offerVoiceConfirmations({
        deliver: () =>
          new Promise<"sent">(() => {
            // Never settles: Discord stalled.
          }),
        userId: "900000000000000071",
        answer: ANSWER,
        guildId: GUILD,
      });
      await vi.advanceTimersByTimeAsync(3000);
      await expect(outcome).resolves.toBe("pending");
    } finally {
      vi.useRealTimers();
    }
  });

  test("offers nothing without a delivery", async () => {
    const outcome = await offerVoiceConfirmations({
      deliver: undefined,
      userId: "900000000000000071",
      answer: ANSWER,
      guildId: GUILD,
    });
    expect(outcome).toBe("none");
  });
});
