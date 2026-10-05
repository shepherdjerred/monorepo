import { describe, expect, it } from "vitest";
import {
  agentInvocation,
  claudeLastMessage,
  parseUsage,
} from "#evals/lib/agents.ts";
import { renderReport } from "#evals/lib/report.ts";
import { selectTasks } from "#evals/lib/tasks.ts";

const base = {
  model: null,
  prompt: "do the task",
  worktree: "/w",
  lastMessagePath: "/t/last.md",
  realHome: "/home/u",
};

describe("agentInvocation", () => {
  it("runs codex non-interactively with the real CODEX_HOME", () => {
    const invocation = agentInvocation({ ...base, agent: "codex" });
    expect(invocation.argv).toEqual([
      "codex",
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "-C",
      "/w",
      "-o",
      "/t/last.md",
      "do the task",
    ]);
    expect(invocation.env).toEqual({ CODEX_HOME: "/home/u/.codex" });
  });

  it("runs claude with its real config dir and no credentials", () => {
    const invocation = agentInvocation({
      ...base,
      agent: "claude",
      model: "claude-opus-5-5",
    });
    expect(invocation.argv).toContain("--dangerously-skip-permissions");
    expect(invocation.argv).toContain("claude-opus-5-5");
    expect(invocation.env).toEqual({ CLAUDE_CONFIG_DIR: "/home/u/.claude" });
  });
});

describe("parseUsage", () => {
  it("sums codex turn usage and ignores noise", () => {
    const events = [
      '{"type":"thread.started"}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":10}}',
      "not json",
      '{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":5}}',
      '{"type":"turn.compl',
    ].join("\n");
    expect(parseUsage("codex", events)).toEqual({
      inputTokens: 150,
      cachedInputTokens: 80,
      outputTokens: 15,
    });
    expect(parseUsage("codex", "")).toBeNull();
  });

  it("reads claude's result event", () => {
    const events = [
      '{"type":"system"}',
      '{"type":"result","result":"done!","total_cost_usd":1.5,"usage":{"input_tokens":10,"cache_read_input_tokens":90,"cache_creation_input_tokens":5,"output_tokens":7}}',
    ].join("\n");
    expect(parseUsage("claude", events)).toEqual({
      inputTokens: 105,
      cachedInputTokens: 90,
      outputTokens: 7,
      costUsd: 1.5,
    });
    expect(claudeLastMessage(events)).toBe("done!");
  });
});

describe("selectTasks and renderReport", () => {
  it("selects tasks and rejects unknown ids", () => {
    expect(selectTasks("e1, e4").map((task) => task.id)).toEqual(["e1", "e4"]);
    expect(selectTasks("all")).toHaveLength(12);
    expect(selectTasks("m1,m2").map((task) => task.preamble)).toEqual([
      "natural",
      "natural",
    ]);
    expect(() => selectTasks("e9")).toThrow(/Unknown task "e9"/u);
  });

  it("renders a summary table and per-task checks", () => {
    const markdown = renderReport({
      runId: "ev-1",
      startedAt: "2026-10-04T00:00:00Z",
      agent: "codex",
      model: null,
      head: "0123456789abcdef",
      tasks: [
        {
          id: "e1",
          title: "tower",
          status: "passed",
          agentExitCode: 0,
          seconds: 400,
          usage: {
            inputTokens: 1_200_000,
            cachedInputTokens: 1_000_000,
            outputTokens: 13_000,
          },
          checks: [{ name: "wall ring", pass: true, detail: "332/332" }],
          artifacts: [],
          notes: [],
          lastMessage: "Built it.",
          taskDir: "/r/e1",
        },
      ],
    });
    expect(markdown).toContain("**1/1 passed.**");
    expect(markdown).toContain(
      "| e1 | tower | passed | 1/1 | 400 s | 1200k in (1000k cached) / 13k out |",
    );
    expect(markdown).toContain("- ✅ wall ring — 332/332");
    expect(markdown).toContain("> Built it.");
  });
});
