import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { register } from "#observability/metrics.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import type { AgentTaskCommand } from "./agent-task-command.ts";

const originalFetch = globalThis.fetch;
const originalGitHubAppId = process.env.GITHUB_APP_ID;
const originalGitHubAppInstallationId = process.env.GITHUB_APP_INSTALLATION_ID;
const originalGitHubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

async function testPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const encoded = btoa(String.fromCodePoint(...new Uint8Array(pkcs8)));
  const lines = encoded.match(/.{1,64}/g) ?? [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
    "",
  ].join("\n");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

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
  beforeAll(async () => {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_INSTALLATION_ID = "67890";
    process.env.GITHUB_APP_PRIVATE_KEY = await testPrivateKeyPem();

    const fetchStub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          token: "test-github-app-token",
          expires_at: "2030-01-01T00:00:00.000Z",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    globalThis.fetch = fetchStub;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("GITHUB_APP_ID", originalGitHubAppId);
    restoreEnv("GITHUB_APP_INSTALLATION_ID", originalGitHubAppInstallationId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", originalGitHubAppPrivateKey);
  });

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
