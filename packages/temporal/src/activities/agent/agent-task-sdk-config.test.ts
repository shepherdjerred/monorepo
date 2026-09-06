import { describe, expect, it } from "vitest";
import { AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX } from "#shared/agent/agent-task.ts";
import {
  AGENT_ALLOWED_TOOLS,
  buildAgentTaskSdkConfig,
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
    expect(config.model).toBe("gpt-5.6-luna");
    expect(config.outputSchema).toEqual(AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX);
    expect(config.prompt).toContain("report-only");
  });

  it("retains Claude decoding but rejects fresh legacy execution", () => {
    expect(() =>
      buildAgentTaskSdkConfig(
        {
          title: "Legacy audit",
          prompt: "Generate the report.",
          provider: "claude",
          mode: "report-only",
          repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
          allowSelfCancel: false,
        },
        workdir,
      ),
    ).toThrow("can be decoded for replay but cannot execute");
    expect(AGENT_ALLOWED_TOOLS).toEqual([
      "Bash",
      "Read",
      "Grep",
      "Glob",
      "WebFetch",
    ]);
  });
});
