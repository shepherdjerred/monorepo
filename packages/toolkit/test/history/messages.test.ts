import { describe, expect, test } from "bun:test";
import {
  openingPrompt,
  openingPromptHash,
  parseConversationEnvelope,
} from "#lib/history/messages.ts";

function parsedOpening(secondBlock: string) {
  return parseConversationEnvelope(
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Shared first block" },
          { type: "tool_result", content: "role-aware tool output" },
          { type: "text", text: secondBlock },
        ],
      },
    },
    "unknown",
    "2026-08-18T00:00:00.000Z",
  );
}

describe("history opening prompts", () => {
  test("hashes every dialogue block in the first envelope", () => {
    const first = parsedOpening("First session detail");
    const second = parsedOpening("Second session detail");

    expect(first.map((message) => message.role)).toEqual([
      "user",
      "tool",
      "user",
    ]);
    expect(openingPrompt(first)).toBe(
      "Shared first block\nFirst session detail",
    );
    expect(openingPromptHash(openingPrompt(first))).not.toBe(
      openingPromptHash(openingPrompt(second)),
    );
  });
});
