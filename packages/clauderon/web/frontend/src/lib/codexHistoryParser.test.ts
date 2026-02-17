import { describe, expect, test } from "bun:test";
import { isCodexFormat, parseCodexHistoryLines } from "./codexHistoryParser";
import { parseHistoryLinesAuto } from "./historyParser";

describe("isCodexFormat", () => {
  test("returns true for session_meta type", () => {
    const line = JSON.stringify({
      timestamp: "2025-01-15T10:00:00Z",
      type: "session_meta",
      payload: {},
    });
    expect(isCodexFormat(line)).toBe(true);
  });

  test("returns true for response_item type", () => {
    const line = JSON.stringify({
      timestamp: "2025-01-15T10:00:00Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [] },
    });
    expect(isCodexFormat(line)).toBe(true);
  });

  test("returns true for event_msg type", () => {
    const line = JSON.stringify({
      timestamp: "2025-01-15T10:00:00Z",
      type: "event_msg",
      payload: {},
    });
    expect(isCodexFormat(line)).toBe(true);
  });

  test("returns true for turn_context type", () => {
    const line = JSON.stringify({
      timestamp: "2025-01-15T10:00:00Z",
      type: "turn_context",
      payload: {},
    });
    expect(isCodexFormat(line)).toBe(true);
  });

  test("returns false for Claude Code format (user type)", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "123",
      parentUuid: null,
      timestamp: "2025-01-15T10:00:00Z",
      message: { role: "user", content: "hello" },
    });
    expect(isCodexFormat(line)).toBe(false);
  });

  test("returns false for Claude Code format (assistant type)", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "123",
      parentUuid: "456",
      timestamp: "2025-01-15T10:00:00Z",
      message: { role: "assistant", content: "hi" },
    });
    expect(isCodexFormat(line)).toBe(false);
  });

  test("returns false for invalid JSON", () => {
    expect(isCodexFormat("not valid json")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isCodexFormat("")).toBe(false);
  });
});

describe("parseCodexHistoryLines", () => {
  test("parses user message", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello Codex" }],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Hello Codex");
  });

  test("parses assistant message", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I can help you with that." }],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.content).toBe("I can help you with that.");
  });

  test("parses function call (tool use)", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "read_file",
          arguments: '{"path": "/test/file.ts"}',
          call_id: "call_123",
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.content).toBe("Using tool: read_file");
    expect(messages[0]?.toolUses).toHaveLength(1);
    expect(messages[0]?.toolUses?.[0]?.name).toBe("read_file");
    expect(messages[0]?.toolUses?.[0]?.input).toEqual({
      path: "/test/file.ts",
    });
  });

  test("matches function call output to function call", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "read_file",
          arguments: '{"path": "/test/file.ts"}',
          call_id: "call_123",
        },
      }),
      JSON.stringify({
        timestamp: "2025-01-15T10:00:01Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_123",
          output: "file contents here",
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolUses?.[0]?.result).toBe("file contents here");
  });

  test("parses reasoning summary", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [
            { type: "summary_text", text: "I need to read the file first." },
          ],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.content).toContain("Thinking:");
    expect(messages[0]?.content).toContain("I need to read the file first.");
  });

  test("skips environment context messages", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<environment_context>...</environment_context>",
            },
          ],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(0);
  });

  test("skips non-response_item entries", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "session_meta",
        payload: { version: "1.0" },
      }),
      JSON.stringify({
        timestamp: "2025-01-15T10:00:01Z",
        type: "event_msg",
        payload: { event: "start" },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(0);
  });

  test("skips empty lines", () => {
    const lines = [
      "",
      "  ",
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
  });

  test("handles invalid JSON lines gracefully", () => {
    const lines = [
      "invalid json",
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
  });

  test("extracts code blocks from message content", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Here is the code:\n```typescript\nconst x = 1;\n```",
            },
          ],
        },
      }),
    ];

    const messages = parseCodexHistoryLines(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.codeBlocks).toHaveLength(1);
    expect(messages[0]?.codeBlocks?.[0]?.language).toBe("typescript");
    expect(messages[0]?.codeBlocks?.[0]?.code).toBe("const x = 1;");
  });

  test("returns empty array for empty lines", () => {
    expect(parseCodexHistoryLines([])).toEqual([]);
  });
});

describe("parseHistoryLinesAuto", () => {
  test("auto-detects Codex format and parses correctly", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-15T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      }),
    ];

    const messages = parseHistoryLinesAuto(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Hello");
  });

  test("auto-detects Claude Code format and parses correctly", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "test-uuid",
        parentUuid: null,
        timestamp: "2025-01-15T10:00:00.000Z",
        message: { role: "user", content: "Hello Claude" },
      }),
    ];

    const messages = parseHistoryLinesAuto(lines);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Hello Claude");
  });

  test("returns empty array for empty lines", () => {
    expect(parseHistoryLinesAuto([])).toEqual([]);
  });

  test("returns empty array for only whitespace lines", () => {
    expect(parseHistoryLinesAuto(["", "  ", "\t"])).toEqual([]);
  });
});
