import { describe, expect, test } from "vitest";
import { renderBlock } from "#lib/history/captures/render.ts";

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
