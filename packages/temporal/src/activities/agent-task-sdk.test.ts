import { describe, expect, test } from "vitest";
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import { codexFinalizationToolViolation } from "./agent-task-sdk.ts";

const TOOL_ITEMS: readonly ThreadItem[] = [
  {
    id: "item-command",
    type: "command_execution",
    command: "rg secrets",
    aggregated_output: "",
    status: "completed",
  },
  {
    id: "item-patch",
    type: "file_change",
    changes: [{ path: "report.md", kind: "update" }],
    status: "completed",
  },
  {
    id: "item-mcp",
    type: "mcp_tool_call",
    server: "grafana",
    tool: "query",
    arguments: {},
    status: "completed",
  },
  { id: "item-search", type: "web_search", query: "openrouter status" },
];

const REASONING_ITEMS: readonly ThreadItem[] = [
  { id: "item-message", type: "agent_message", text: "{}" },
  { id: "item-reasoning", type: "reasoning", text: "considering" },
  { id: "item-todo", type: "todo_list", items: [] },
];

function completed(item: ThreadItem): ThreadEvent {
  return { type: "item.completed", item };
}

describe("codexFinalizationToolViolation", () => {
  test("rejects every tool item a finalization thread can still reach", () => {
    for (const item of TOOL_ITEMS) {
      expect(
        codexFinalizationToolViolation({
          phase: "finalization",
          event: completed(item),
        }),
      ).toBe(
        `Codex finalization invoked the ${item.type} tool; the finalization phase may only reason over the captured evidence catalog`,
      );
      expect(
        codexFinalizationToolViolation({
          phase: "finalization",
          event: { type: "item.started", item },
        }),
      ).toContain(item.type);
    }
  });

  test("allows the model's own reasoning and message items", () => {
    for (const item of REASONING_ITEMS) {
      expect(
        codexFinalizationToolViolation({
          phase: "finalization",
          event: completed(item),
        }),
      ).toBeUndefined();
    }
  });

  test("leaves the investigation and single phases unconstrained", () => {
    for (const phase of ["investigation", "single"] as const) {
      for (const item of TOOL_ITEMS) {
        expect(
          codexFinalizationToolViolation({ phase, event: completed(item) }),
        ).toBeUndefined();
      }
    }
  });

  test("ignores non-item events", () => {
    expect(
      codexFinalizationToolViolation({
        phase: "finalization",
        event: { type: "thread.started", thread_id: "thread-1" },
      }),
    ).toBeUndefined();
  });
});
