import { describe, expect, test } from "bun:test";
import {
  formatScoutPublishCustomId,
  isScoutCustomId,
  parseScoutPublishCustomId,
} from "#src/discord/scout/custom-id.ts";

const conversationId = "10000000-0000-4000-8000-000000000001";
const assistantMessageId = "10000000-0000-4000-8000-000000000002";

describe("Scout component IDs", () => {
  test("round-trips the versioned publish key within Discord's limit", () => {
    const customId = formatScoutPublishCustomId({
      conversationId,
      assistantMessageId,
    });
    expect(customId).toBe(
      `scout:1:publish:${conversationId}:${assistantMessageId}`,
    );
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseScoutPublishCustomId(customId)).toEqual({
      conversationId,
      assistantMessageId,
    });
  });

  test.each([
    "scout:",
    `scout:2:publish:${conversationId}:${assistantMessageId}`,
    `scout:1:delete:${conversationId}:${assistantMessageId}`,
    `scout:1:publish:not-a-uuid:${assistantMessageId}`,
    `scout:1:publish:${conversationId}`,
  ])("claims but rejects malformed Scout IDs (%s)", (customId) => {
    expect(isScoutCustomId(customId)).toBe(true);
    expect(parseScoutPublishCustomId(customId)).toBeUndefined();
  });
});
