import { describe, expect, test } from "vitest";
import { normalizeItemEvent } from "./items.ts";

describe("Codex App Server item normalization", () => {
  test("parses file-change kinds from the protocol string enum", () => {
    expect(
      normalizeItemEvent("item/completed", {
        id: "file-change",
        type: "fileChange",
        changes: [
          { path: "added.ts", kind: "add" },
          { path: "updated.ts", kind: "update" },
          { path: "deleted.ts", kind: "delete" },
        ],
        status: "completed",
      }),
    ).toEqual({
      type: "item.completed",
      item: {
        id: "file-change",
        type: "file_change",
        changes: [
          { path: "added.ts", kind: "add" },
          { path: "updated.ts", kind: "update" },
          { path: "deleted.ts", kind: "delete" },
        ],
        status: "completed",
      },
    });
  });

  test("preserves completed MCP results and errors for evidence", () => {
    expect(
      normalizeItemEvent("item/completed", {
        id: "mcp-success",
        type: "mcpToolCall",
        server: "records",
        tool: "lookup",
        arguments: { id: "record-1" },
        result: {
          content: [{ type: "text", text: "secret result" }],
          structuredContent: { verified: true },
          _meta: { source: "fixture" },
        },
        error: null,
        status: "completed",
      }),
    ).toEqual({
      type: "item.completed",
      item: {
        id: "mcp-success",
        type: "mcp_tool_call",
        server: "records",
        tool: "lookup",
        arguments: { id: "record-1" },
        result: {
          content: [{ type: "text", text: "secret result" }],
          structured_content: { verified: true },
          _meta: { source: "fixture" },
        },
        status: "completed",
      },
    });

    expect(
      normalizeItemEvent("item/completed", {
        id: "mcp-failure",
        type: "mcpToolCall",
        server: "records",
        tool: "lookup",
        arguments: {},
        result: null,
        error: { message: "lookup failed" },
        status: "failed",
      }),
    ).toMatchObject({
      item: { error: { message: "lookup failed" }, status: "failed" },
    });
  });
});
