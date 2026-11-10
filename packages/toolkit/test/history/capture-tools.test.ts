import { describe, expect, test } from "vitest";
import {
  renderBlock,
  summarizeResponse,
} from "#lib/history/captures/render.ts";
import { parseHttpResponse } from "#lib/history/captures/response.ts";

describe("captured tool definitions", () => {
  test("expand Gemini declarations and keep OpenAI function parameters", () => {
    const gemini = renderBlock("unknown", "tools", {
      functionDeclarations: [
        {
          name: "read_file",
          description: "Read",
          parameters: { type: "OBJECT" },
        },
        { name: "list_dir", description: "List" },
      ],
    });
    expect(gemini.parts).toEqual([
      {
        type: "tool_definition",
        name: "read_file",
        namespace: null,
        description: "Read",
        parameters: { type: "OBJECT" },
      },
      {
        type: "tool_definition",
        name: "list_dir",
        namespace: null,
        description: "List",
        parameters: null,
      },
    ]);
    const chat = renderBlock("openai-chat", "tools", {
      type: "function",
      function: {
        name: "grep",
        description: "Search",
        parameters: { type: "object" },
      },
    });
    expect(chat.parts).toEqual([
      {
        type: "tool_definition",
        name: "grep",
        namespace: null,
        description: "Search",
        parameters: { type: "object" },
      },
    ]);
  });

  test("qualify nested namespaces", () => {
    const nested = renderBlock("openai-responses", "tools", {
      type: "namespace",
      name: "outer",
      tools: [
        {
          type: "namespace",
          name: "inner",
          tools: [{ type: "function", name: "go" }],
        },
      ],
    });
    expect(nested.parts).toEqual([
      {
        type: "tool_definition",
        name: "go",
        namespace: "outer.inner",
        description: null,
        parameters: null,
      },
    ]);
  });
});

function chunk(
  delta: Record<string, unknown>,
  finish: string | null = null,
): string {
  const event = {
    id: "chatcmpl_1",
    model: "gpt-fixture",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

function call(index: number, fields: Record<string, unknown>) {
  return { tool_calls: [{ index, ...fields }] };
}

describe("streamed Chat Completions responses", () => {
  test("assemble tool calls from delta fragments by index", () => {
    const body = [
      chunk({ role: "assistant", content: "Checking." }),
      chunk(
        call(0, {
          id: "call_a",
          type: "function",
          function: { name: "exec", arguments: "" },
        }),
      ),
      chunk(call(0, { function: { arguments: '{"cmd":' } })),
      chunk(
        call(1, {
          id: "call_b",
          type: "function",
          function: { name: "read", arguments: '{"path"' },
        }),
      ),
      chunk(call(0, { function: { arguments: '"ls"}' } })),
      chunk(call(1, { function: { arguments: ':"a.txt"}' } })),
      chunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ].join("");
    const parsed = parseHttpResponse("openai-chat", body, "text/event-stream");
    if (parsed === null) throw new Error("the stream did not parse");
    expect(parsed.stopReason).toBe("tool_calls");
    expect(
      summarizeResponse("openai-chat", parsed.value, parsed.stopReason),
    ).toEqual({
      text: "Checking.",
      reasoning: "",
      toolCalls: [
        { id: "call_a", name: "exec", arguments: { cmd: "ls" } },
        { id: "call_b", name: "read", arguments: { path: "a.txt" } },
      ],
      stopReason: "tool_calls",
    });
  });
});
