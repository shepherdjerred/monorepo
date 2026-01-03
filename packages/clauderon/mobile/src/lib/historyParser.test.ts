import { describe, expect, test } from "bun:test";
import { parseHistoryEntry, parseHistoryLines } from "./historyParser";

describe("parseHistoryEntry", () => {
  test("parses user message with string content", () => {
    const jsonl = JSON.stringify({
      type: "user",
      uuid: "msg-1",
      parentUuid: null,
      timestamp: "2025-01-01T12:00:00Z",
      message: {
        role: "user",
        content: "Hello, how are you?",
      },
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).not.toBeNull();
    expect(message?.role).toBe("user");
    expect(message?.content).toBe("Hello, how are you?");
    expect(message?.id).toBe("msg-1");
    expect(message?.timestamp).toBeInstanceOf(Date);
  });

  test("parses assistant message with text blocks", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      uuid: "msg-2",
      parentUuid: "msg-1",
      timestamp: "2025-01-01T12:00:01Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll help you with that. " },
          { type: "text", text: "Let me check." },
        ],
      },
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).not.toBeNull();
    expect(message?.role).toBe("assistant");
    expect(message?.content).toBe("I'll help you with that. Let me check.");
  });

  test("parses message with tool_use blocks", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      uuid: "msg-3",
      parentUuid: "msg-2",
      timestamp: "2025-01-01T12:00:02Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Reading file..." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "/path/to/file.ts" },
          },
        ],
      },
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).not.toBeNull();
    expect(message?.toolUses).toHaveLength(1);
    expect(message?.toolUses?.[0]?.name).toBe("Read");
    expect(message?.toolUses?.[0]?.input).toEqual({ file_path: "/path/to/file.ts" });
    expect(message?.toolUses?.[0]?.result).toBeUndefined();
  });

  test("skips summary entries", () => {
    const jsonl = JSON.stringify({
      type: "summary",
      uuid: "summary-1",
      parentUuid: null,
      timestamp: "2025-01-01T12:00:03Z",
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).toBeNull();
  });

  test("skips file-history-snapshot entries", () => {
    const jsonl = JSON.stringify({
      type: "file-history-snapshot",
      uuid: "snapshot-1",
      parentUuid: null,
      timestamp: "2025-01-01T12:00:04Z",
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).toBeNull();
  });

  test("extracts code blocks from text content", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      uuid: "msg-4",
      parentUuid: null,
      timestamp: "2025-01-01T12:00:05Z",
      message: {
        role: "assistant",
        content: "Here's an example:\n```typescript\nconst x = 1;\n```",
      },
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).not.toBeNull();
    expect(message?.codeBlocks).toHaveLength(1);
    expect(message?.codeBlocks?.[0]?.language).toBe("typescript");
    expect(message?.codeBlocks?.[0]?.code).toBe("const x = 1;");
  });

  test("handles missing message field", () => {
    const jsonl = JSON.stringify({
      type: "user",
      uuid: "msg-5",
      parentUuid: null,
      timestamp: "2025-01-01T12:00:06Z",
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).toBeNull();
  });

  test("handles malformed JSON", () => {
    const jsonl = "{ invalid json }";
    const message = parseHistoryEntry(jsonl);
    expect(message).toBeNull();
  });

  test("handles empty content blocks", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      uuid: "msg-6",
      parentUuid: null,
      timestamp: "2025-01-01T12:00:07Z",
      message: {
        role: "assistant",
        content: [],
      },
    });

    const message = parseHistoryEntry(jsonl);
    expect(message).not.toBeNull();
    expect(message?.content).toBe("");
    expect(message?.toolUses).toBeUndefined();
  });
});

describe("parseHistoryLines", () => {
  test("parses multiple messages", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: { role: "user", content: "Hello" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: { role: "assistant", content: "Hi there!" },
      }),
    ];

    const messages = parseHistoryLines(lines);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
  });

  test("matches tool results to tool uses (two-pass parsing)", () => {
    const lines = [
      // Assistant message with tool_use
      JSON.stringify({
        type: "assistant",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reading file..." },
            {
              type: "tool_use",
              id: "tool-123",
              name: "Read",
              input: { file_path: "/file.ts" },
            },
          ],
        },
      }),
      // User message with tool_result
      JSON.stringify({
        type: "user",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-123",
              content: "file contents here",
            },
          ],
        },
      }),
    ];

    const messages = parseHistoryLines(lines);
    expect(messages).toHaveLength(2);

    // First message should have tool use with matched result
    const firstMessage = messages[0];
    expect(firstMessage?.toolUses).toHaveLength(1);
    expect(firstMessage?.toolUses?.[0]?.name).toBe("Read");
    expect(firstMessage?.toolUses?.[0]?.result).toBe("file contents here");
  });

  test("handles tool results appearing before tool uses in stream", () => {
    // This tests the two-pass approach handles out-of-order messages
    const lines = [
      // User message with tool_result (appears first)
      JSON.stringify({
        type: "user",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-456",
              content: "result data",
            },
          ],
        },
      }),
      // Assistant message with tool_use (appears second)
      JSON.stringify({
        type: "assistant",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-456",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
      }),
    ];

    const messages = parseHistoryLines(lines);
    expect(messages).toHaveLength(2);

    // Find the assistant message and check tool result was matched
    const assistantMessage = messages.find((m) => m.role === "assistant");
    expect(assistantMessage?.toolUses).toHaveLength(1);
    expect(assistantMessage?.toolUses?.[0]?.result).toBe("result data");
  });

  test("handles multiple tool uses in one message", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/file1.ts" },
            },
            {
              type: "tool_use",
              id: "tool-2",
              name: "Read",
              input: { file_path: "/file2.ts" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "result1" },
            { type: "tool_result", tool_use_id: "tool-2", content: "result2" },
          ],
        },
      }),
    ];

    const messages = parseHistoryLines(lines);
    const assistantMessage = messages.find((m) => m.role === "assistant");
    expect(assistantMessage?.toolUses).toHaveLength(2);
    expect(assistantMessage?.toolUses?.[0]?.result).toBe("result1");
    expect(assistantMessage?.toolUses?.[1]?.result).toBe("result2");
  });

  test("skips empty lines", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: { role: "user", content: "Hello" },
      }),
      "",
      "   ",
      JSON.stringify({
        type: "assistant",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: { role: "assistant", content: "Hi" },
      }),
    ];

    const messages = parseHistoryLines(lines);
    expect(messages).toHaveLength(2);
  });

  test("skips malformed lines and continues", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: { role: "user", content: "First" },
      }),
      "{ invalid json",
      JSON.stringify({
        type: "assistant",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: { role: "assistant", content: "Second" },
      }),
    ];

    const messages = parseHistoryLines(lines);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("First");
    expect(messages[1]?.content).toBe("Second");
  });

  test("filters out null messages (summaries, snapshots)", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: { role: "user", content: "Hello" },
      }),
      JSON.stringify({
        type: "summary",
        uuid: "summary-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:01Z",
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:02Z",
        message: { role: "assistant", content: "Hi" },
      }),
    ];

    const messages = parseHistoryLines(lines);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("Hello");
    expect(messages[1]?.content).toBe("Hi");
  });

  test("handles tool results with object content", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        uuid: "msg-1",
        parentUuid: null,
        timestamp: "2025-01-01T12:00:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Grep",
              input: { pattern: "test" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "msg-2",
        parentUuid: "msg-1",
        timestamp: "2025-01-01T12:00:01Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: { matches: ["line1", "line2"] },
            },
          ],
        },
      }),
    ];

    const messages = parseHistoryLines(lines);
    const assistantMessage = messages.find((m) => m.role === "assistant");
    expect(assistantMessage?.toolUses?.[0]?.result).toBe(
      JSON.stringify({ matches: ["line1", "line2"] })
    );
  });

  test("handles empty array", () => {
    const messages = parseHistoryLines([]);
    expect(messages).toEqual([]);
  });
});
