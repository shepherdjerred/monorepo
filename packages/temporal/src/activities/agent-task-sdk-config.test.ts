import { describe, expect, it } from "bun:test";
import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
} from "#shared/agent-task.ts";
import {
  buildAgentTaskSdkConfig,
  CLAUDE_AGENT_ALLOWED_TOOLS,
} from "./agent-task-sdk-config.ts";

const workdir = "/tmp/agent-task-sdk-config";

describe("buildAgentTaskSdkConfig", () => {
  it("uses the generated strict nullable schema for Codex SDK output", () => {
    const config = buildAgentTaskSdkConfig(
      {
        title: "CI I/O report",
        prompt: "Generate the report.",
        provider: "codex",
        mode: "report-only",
        repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
        allowSelfCancel: false,
      },
      workdir,
    );

    expect(config.provider).toBe("codex");
    expect(config.model).toBe("gpt-5.6-sol");
    expect(config.outputSchema).toEqual(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX);
    expect(config.prompt).toContain("report-only");
  });

  it("uses Claude's plain optional schema and bounded native tool set", () => {
    const config = buildAgentTaskSdkConfig(
      {
        title: "Homelab audit",
        prompt: "Generate the report.",
        provider: "claude",
        mode: "report-only",
        repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
        allowSelfCancel: false,
        maxTurns: 24,
      },
      workdir,
    );

    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-opus-5");
    expect(config.maxTurns).toBe(24);
    expect(config.outputSchema).toEqual(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE);
    expect(config.outputSchema).not.toEqual(
      AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
    );
    expect(CLAUDE_AGENT_ALLOWED_TOOLS).toEqual([
      "Bash",
      "Read",
      "Grep",
      "Glob",
      "WebFetch",
    ]);
  });
});
