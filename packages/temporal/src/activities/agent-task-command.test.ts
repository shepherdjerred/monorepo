import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE,
  AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX,
  AgentTaskInputV2Schema,
  AgentTaskResultPayloadV2Schema,
} from "#shared/agent-task.ts";
import {
  buildAgentTaskCommand,
  CLAUDE_CODE_MINIMUM_VERSION,
  CLAUDE_CODE_PINNED_VERSION,
} from "./agent-task-command.ts";

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
  it("keeps the Claude image pin at the structured-output contract minimum", async () => {
    const dockerfile = await Bun.file(
      `${import.meta.dir}/../../Dockerfile`,
    ).text();
    const match = /^ARG CLAUDE_CODE_VERSION=(.+)$/m.exec(dockerfile);
    const imageVersion = match?.[1];
    if (imageVersion === undefined) {
      throw new Error("Temporal Dockerfile is missing CLAUDE_CODE_VERSION");
    }
    expect(imageVersion).toBe(CLAUDE_CODE_PINNED_VERSION);
    const versionParts = imageVersion.split(".").map(Number);
    const minimumParts = CLAUDE_CODE_MINIMUM_VERSION.split(".").map(Number);
    const imageNumber = Number(
      versionParts.map((part) => String(part).padStart(4, "0")).join(""),
    );
    const minimumNumber = Number(
      minimumParts.map((part) => String(part).padStart(4, "0")).join(""),
    );
    expect(imageNumber).toBeGreaterThanOrEqual(minimumNumber);
  });

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
      undefined,
      "http://127.0.0.1:45678",
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
    expect(command.args).toContain('model_provider="agent_credential_broker"');
    expect(command.args.join(" ")).toContain(
      'base_url="http://127.0.0.1:45678/v1"',
    );
    expect(command.args.join(" ")).toContain("supports_websockets=false");
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
      undefined,
      "http://127.0.0.1:45678",
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
    expect(command.args).toContain("--output-format");
    expect(command.args[command.args.indexOf("--output-format") + 1]).toBe(
      "stream-json",
    );
    expect(command.args).toContain("--verbose");
    expect(command.args).not.toContain("--output-schema");
  });

  it("disables Claude tools and supplies captured receipts during v2 finalization", async () => {
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-claude-token";
    const workdir = await mkdtemp(
      path.join(os.tmpdir(), "agent-task-command-"),
    );
    temporaryDirectories.push(workdir);
    const input = AgentTaskInputV2Schema.parse({
      contractVersion: 2,
      title: "Service report",
      prompt: "Check service health.",
      checks: [
        {
          id: "service-health",
          label: "Service health",
          required: true,
          evidenceRequirement: "A successful health command.",
          evidenceCollectors: [
            {
              id: "service-health-command",
              kind: "command",
              argv: ["service-health", "--json"],
              output: "json",
              expectation: { kind: "exit-code", passedExitCodes: [0] },
            },
          ],
        },
      ],
      provider: "claude",
      mode: "report-only",
      repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
      allowSelfCancel: false,
    });
    const preliminary = AgentTaskResultPayloadV2Schema.parse({
      headline: "Preliminary healthy result.",
      checks: [
        {
          id: "service-health",
          status: "passed",
          summary: "Health command passed.",
          evidenceReceiptIds: ["tool-1"],
        },
      ],
      findings: [],
      limitations: [],
      actions: [],
    });

    const command = await buildAgentTaskCommand(
      input,
      workdir,
      {
        kind: "finalization",
        evidence: [
          {
            id: "tool-1",
            source: "Bash",
            observedAt: "2026-08-10T17:00:00.000Z",
            status: "success",
            command: "service-health --json",
            excerpt: '{"healthy":true}',
          },
        ],
        preliminary,
      },
      "http://127.0.0.1:45678",
    );

    expect(command.args).toContain("--tools");
    expect(command.args[command.args.indexOf("--tools") + 1]).toBe("");
    expect(command.args).not.toContain("--allowed-tools");
    expect(command.prompt).toContain("Finalization phase:");
    expect(command.prompt).toContain('"id": "tool-1"');
    expect(command.prompt).toContain("Do not invoke tools");
  });
});
