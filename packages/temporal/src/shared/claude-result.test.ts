import { describe, expect, it } from "bun:test";
import {
  parseClaudeResultMessage,
  summarizeClaudeStreamLine,
} from "./claude-result.ts";

describe("parseClaudeResultMessage", () => {
  it("parses the legacy single-object --output-format json shape", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "hello",
      num_turns: 3,
    });
    const msg = parseClaudeResultMessage(stdout);
    expect(msg.result).toBe("hello");
    expect(msg.num_turns).toBe(3);
  });

  it("extracts the final result line from stream-json NDJSON", () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}',
      '{"type":"result","subtype":"success","result":"done","num_turns":2}',
    ].join("\n");
    const msg = parseClaudeResultMessage(stdout);
    expect(msg.result).toBe("done");
    expect(msg.num_turns).toBe(2);
  });

  it("surfaces structured_output from the result message (--json-schema)", () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "prose summary",
        structured_output: { outcome: "report-only", reason: "no fix needed" },
      }),
    ].join("\n");
    const msg = parseClaudeResultMessage(stdout);
    expect(msg.result).toBe("prose summary");
    expect(msg.structured_output).toEqual({
      outcome: "report-only",
      reason: "no fix needed",
    });
  });

  it("returns the LAST result line when several are present", () => {
    const stdout = [
      '{"type":"result","result":"first"}',
      '{"type":"result","result":"second"}',
    ].join("\n");
    expect(parseClaudeResultMessage(stdout).result).toBe("second");
  });

  it("tolerates blank lines and non-result NDJSON lines", () => {
    const stdout = [
      "",
      '{"type":"system"}',
      "  ",
      '{"type":"result","result":"ok"}',
      "",
    ].join("\n");
    expect(parseClaudeResultMessage(stdout).result).toBe("ok");
  });

  it("throws on empty stdout (killed before any output)", () => {
    expect(() => parseClaudeResultMessage("   ")).toThrow(/no stdout/);
  });

  it("throws when no result message is present", () => {
    const stdout = ['{"type":"system"}', '{"type":"assistant"}'].join("\n");
    expect(() => parseClaudeResultMessage(stdout)).toThrow(/no claude result/);
  });
});

describe("summarizeClaudeStreamLine", () => {
  it("summarizes a system init line", () => {
    const s = summarizeClaudeStreamLine('{"type":"system","subtype":"init"}');
    expect(s?.type).toBe("system");
    expect(s?.subtype).toBe("init");
  });

  it("extracts tool names and text length from an assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", name: "Bash" },
          { type: "tool_use", name: "Read" },
        ],
      },
    });
    const s = summarizeClaudeStreamLine(line);
    expect(s?.toolNames).toEqual(["Bash", "Read"]);
    expect(s?.textChars).toBe("let me check".length);
  });

  it("captures result metadata", () => {
    const line =
      '{"type":"result","subtype":"success","is_error":false,"num_turns":4,"duration_ms":1200}';
    const s = summarizeClaudeStreamLine(line);
    expect(s?.type).toBe("result");
    expect(s?.isError).toBe(false);
    expect(s?.numTurns).toBe(4);
    expect(s?.durationMs).toBe(1200);
  });

  it("returns undefined for a non-JSON line", () => {
    expect(summarizeClaudeStreamLine("not json at all")).toBeUndefined();
  });
});
