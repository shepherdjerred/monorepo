import { describe, expect, test } from "vitest";
import { ConversationContextStore } from "@shepherdjerred/streambot/discovery/conversation-context.ts";

const SCOPE = {
  guildId: "guild-one",
  channelId: "channel-one",
  userId: "user-one",
} as const;

function candidate(title: string) {
  return {
    token: title,
    provider: "youtube" as const,
    title,
    source: { kind: "url" as const, url: `https://youtu.be/${title}` },
    score: 100,
    reason: "test",
  };
}

describe("conversation context", () => {
  test("does not let an unrelated last result override a qualified history reference", () => {
    const context = new ConversationContextStore();
    context.rememberResult(SCOPE, candidate("Taylor Swift - Style"));

    expect(context.select(SCOPE, "play that Plankton song again")).toBeNull();
    expect(context.select(SCOPE, "play that song again")?.title).toBe(
      "Taylor Swift - Style",
    );
  });

  test("fuzzy-matches a garbled retry against pending candidates", () => {
    const context = new ConversationContextStore();
    context.rememberCandidates(SCOPE, [
      candidate("Travis Scott - SICKO MODE (Official Video)"),
      candidate("Travis Scott - SICKO MODE"),
    ]);

    expect(context.select(SCOPE, "silco")?.title).toBe(
      "Travis Scott - SICKO MODE (Official Video)",
    );
    expect(context.select(SCOPE, "play Suka mode")?.title).toBe(
      "Travis Scott - SICKO MODE (Official Video)",
    );
  });

  test("does not reuse a pending list for an unrelated new title", () => {
    const context = new ConversationContextStore();
    context.rememberCandidates(SCOPE, [
      candidate("Dune: Part One"),
      candidate("Dune: Part Two"),
    ]);
    expect(context.select(SCOPE, "one piece")).toBeNull();

    context.rememberCandidates(SCOPE, [
      candidate("Travis Scott - SICKO MODE (Official Video)"),
      candidate("Travis Scott - SICKO MODE"),
    ]);
    expect(context.select(SCOPE, "play Psycho")).toBeNull();
  });

  test("does not reuse pending One More Time for One More Night", () => {
    const context = new ConversationContextStore();
    context.rememberCandidates(SCOPE, [
      candidate("Daft Punk - One More Time (Official Video)"),
    ]);
    expect(context.select(SCOPE, "play One More Night")).toBeNull();
  });
});
