import { describe, expect, test } from "vitest";
import { ExploreDurablePayloadSchema } from "#src/explore/durable-payload.ts";

const started = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  title: "Weekly games",
  messageId: "22222222-2222-4222-8222-222222222222",
  question: "Who played the most games?",
  expectedCurrentLeafId: null,
  previousCurrentLeafId: null,
  createdConversation: true,
  createdQuestion: true,
};

const legacyRow = {
  summary: { runId: "33333333-3333-4333-8333-333333333333" },
  started,
  guildIds: ["1337623164146155593"],
};

describe("ExploreDurablePayloadSchema", () => {
  test("a row written before `surface` existed parses as web", () => {
    // Durable Explore runs are enqueued only from the web run manager, so this
    // restores what those rows already meant rather than guessing.
    const parsed = ExploreDurablePayloadSchema.parse(legacyRow);

    expect(parsed.surface).toBe("web");
  });

  test("a stored surface is read back rather than defaulted", () => {
    const parsed = ExploreDurablePayloadSchema.parse({
      ...legacyRow,
      surface: "discord",
    });

    expect(parsed.surface).toBe("discord");
  });

  test("an unknown surface is rejected instead of falling back", () => {
    expect(() =>
      ExploreDurablePayloadSchema.parse({ ...legacyRow, surface: "sms" }),
    ).toThrow();
  });
});
