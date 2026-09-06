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
});
