import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
} from "#shared/agent-task.ts";
import { buildAgentTaskCommand } from "./agent-task-command.ts";

const originalCodexApiKey = Bun.env["CODEX_API_KEY"];
const originalOpenAiApiKey = Bun.env["OPENAI_API_KEY"];
const originalClaudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
const temporaryDirectories: string[] = [];

function restoreEnvironment(): void {
  if (originalCodexApiKey === undefined) {
    delete Bun.env["CODEX_API_KEY"];
  } else {
    Bun.env["CODEX_API_KEY"] = originalCodexApiKey;
  }
  if (originalOpenAiApiKey === undefined) {
    delete Bun.env["OPENAI_API_KEY"];
  } else {
    Bun.env["OPENAI_API_KEY"] = originalOpenAiApiKey;
  }
  if (originalClaudeToken === undefined) {
    delete Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  } else {
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = originalClaudeToken;
  }
}

afterEach(async () => {
  restoreEnvironment();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("buildAgentTaskCommand", () => {
  it("writes the generated strict schema for Codex output validation", async () => {
    Bun.env["CODEX_API_KEY"] = "test-codex-key";
    const workdir = await mkdtemp(
      path.join(os.tmpdir(), "agent-task-command-"),
    );
    temporaryDirectories.push(workdir);

    const command = await buildAgentTaskCommand(
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

    const schemaFlagIndex = command.args.indexOf("--output-schema");
    expect(schemaFlagIndex).toBeGreaterThanOrEqual(0);
    const schemaPath = command.args[schemaFlagIndex + 1];
    if (schemaPath === undefined) {
      throw new Error("Codex command omitted the output schema path");
    }
    expect(schemaPath).toBe(`${workdir}/agent-task-output.schema.json`);
    expect(await Bun.file(schemaPath).json()).toEqual(
      AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
    );
  });

  it("passes the generated plain schema inline for Claude output validation", async () => {
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-claude-token";
    const workdir = await mkdtemp(
      path.join(os.tmpdir(), "agent-task-command-"),
    );
    temporaryDirectories.push(workdir);

    const command = await buildAgentTaskCommand(
      {
        title: "Homelab audit",
        prompt: "Generate the report.",
        provider: "claude",
        mode: "report-only",
        repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
        allowSelfCancel: false,
      },
      workdir,
    );

    const schemaFlagIndex = command.args.indexOf("--json-schema");
    expect(schemaFlagIndex).toBeGreaterThanOrEqual(0);
    const schemaArg = command.args[schemaFlagIndex + 1];
    if (schemaArg === undefined) {
      throw new Error("Claude command omitted the inline JSON schema");
    }
    expect(JSON.parse(schemaArg)).toEqual(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE);
    // regression guard: Claude and Codex must never share one schema again
    expect(JSON.parse(schemaArg)).not.toEqual(
      AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
    );
  });
});
