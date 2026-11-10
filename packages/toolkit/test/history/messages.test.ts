import { describe, expect, test } from "vitest";
import {
  openingPrompt,
  openingPromptHash,
  parseConversationEnvelope,
} from "#lib/history/query/messages.ts";

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

describe("history tool calls", () => {
  test("keeps calls whose input has no indexed text key", () => {
    const messages = parseConversationEnvelope(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/repo/app.ts" },
            },
            {
              type: "tool_use",
              name: "Edit",
              input: {
                file_path: "/repo/app.ts",
                old_string: "a",
                new_string: "b",
                token: "never-indexed",
              },
            },
            { type: "tool_use", name: "TodoRead", input: {} },
          ],
        },
      },
      "unknown",
      "2026-08-18T00:00:00.000Z",
    );
    expect(
      messages.map(({ role, text, toolName }) => ({ role, text, toolName })),
    ).toEqual([
      { role: "tool", text: "file_path: /repo/app.ts", toolName: "Read" },
      {
        role: "tool",
        text: "file_path: /repo/app.ts old_string: a new_string: b",
        toolName: "Edit",
      },
      { role: "tool", text: "TodoRead", toolName: "TodoRead" },
    ]);
  });
});
