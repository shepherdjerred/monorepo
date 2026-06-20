import { describe, expect, test } from "bun:test";
import { buildFeedbackRequestMessage } from "#src/discord/utils/feedback.ts";

describe("buildFeedbackRequestMessage", () => {
  test("includes the guild name and a feedback URL", () => {
    const message = buildFeedbackRequestMessage("Cool Server");
    expect(message).toContain("Cool Server");
    expect(message).toMatch(/https?:\/\//);
    expect(message.toLowerCase()).toContain("feedback");
  });
});
