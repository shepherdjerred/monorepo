import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, mock } from "bun:test";
import { register } from "#observability/metrics.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import type { AgentTaskCommand } from "./agent-task-command.ts";

void mock.module("#activities/agent-task-command.ts", () => ({
  buildAgentTaskCommand: async (
    _input: AgentTaskInput,
    workdir: string,
  ): Promise<AgentTaskCommand> => {
    const outputPath = path.join(workdir, "agent-task-output.json");
    const code = [
      `await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({ markdown: "task complete" }));`,
    ].join("\n");
    return {
      args: ["bun", "--eval", code],
      model: "test-model",
      outputPath,
    };
  },
}));

const baseInput: AgentTaskInput = {
  title: "Metric placement test",
  prompt: "Return a short report.",
  provider: "codex",
  mode: "report-only",
  allowSelfCancel: false,
  repo: {
    fullName: "shepherdjerred/monorepo",
    ref: "main",
  },
};

describe("agentTaskActivities", () => {
  it("records a successful run after agent output parses", async () => {
    const { agentTaskActivities } = await import("./agent-task.ts");
    const workdir = await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));

    const result = await agentTaskActivities.runAgentTask({
      input: baseInput,
      workdir,
    });

    expect(result.markdown).toBe("task complete");
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /agent_task_runs_total\{[^}]*provider="codex"[^}]*outcome="success"/,
    );
  });
});
