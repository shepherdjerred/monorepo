import { describe, expect, it } from "bun:test";
import { parseAgentTaskInputsFromMarkdown } from "./agent-task-markdown.ts";

function block(title: string, runAt: string): string {
  return `<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "${title}",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "${runAt}",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [{ "id": "read-only-check", "label": "Read-only check", "required": true, "evidenceRequirement": "Current source or runtime evidence.", "evidenceCriteria": [{ "field": "source", "includes": "runtime-status" }] }],
  "prompt": "Read-only check"
}
-->`;
}

describe("agent-task Markdown blocks", () => {
  it("parses every block in document order", () => {
    const inputs = parseAgentTaskInputsFromMarkdown(
      [
        "# Rollout checks",
        block("Deployment", "2026-08-12T09:00:00-07:00"),
        "Some prose between checks.",
        block("24 hours", "2026-08-13T09:00:00-07:00"),
        block("Seven days", "2026-08-19T09:00:00-07:00"),
      ].join("\n\n"),
    );

    expect(inputs.map((input) => input.title)).toEqual([
      "Deployment",
      "24 hours",
      "Seven days",
    ]);
  });

  it("validates all three capacity-rollout follow-ups", async () => {
    const path = new URL(
      "../../../docs/todos/homelab-capacity-rollout-acceptance.md",
      import.meta.url,
    );
    const inputs = parseAgentTaskInputsFromMarkdown(
      await Bun.file(path).text(),
    );
    expect(inputs).toHaveLength(3);
    expect(inputs.every((input) => input.mode === "report-only")).toBe(true);
  });

  it("fails if a later block is malformed", () => {
    expect(() =>
      parseAgentTaskInputsFromMarkdown(
        `${block("Deployment", "2026-08-12T09:00:00-07:00")}\n<!-- temporal-agent-task\n{"title":"broken"}\n-->`,
      ),
    ).toThrow();
  });

  it("fails when a document contains no task block", () => {
    expect(() => parseAgentTaskInputsFromMarkdown("# No checks")).toThrow(
      "No <!-- temporal-agent-task block found",
    );
  });

  it("fails when the final task block is unclosed", () => {
    expect(() =>
      parseAgentTaskInputsFromMarkdown("<!-- temporal-agent-task\n{}"),
    ).toThrow("Unclosed <!-- temporal-agent-task block");
  });
});
