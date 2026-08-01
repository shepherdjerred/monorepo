import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { register } from "#observability/metrics.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import type { AgentTaskCommand } from "./agent-task-command.ts";
import { createAgentTaskActivities } from "./agent-task.ts";
import { agentTaskSecretTokens, envForProvider } from "./agent-task-env.ts";

const originalFetch = globalThis.fetch;
const originalGitHubAppId = Bun.env["GITHUB_APP_ID"];
const originalGitHubAppInstallationId = Bun.env["GITHUB_APP_INSTALLATION_ID"];
const originalGitHubAppPrivateKey = Bun.env["GITHUB_APP_PRIVATE_KEY"];

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

function restoreGitHubAppEnv(): void {
  restoreGitHubAppId();
  restoreGitHubAppInstallationId();
  restoreGitHubAppPrivateKey();
}

function restoreGitHubAppId(): void {
  if (originalGitHubAppId === undefined) {
    delete Bun.env["GITHUB_APP_ID"];
    return;
  }
  Bun.env["GITHUB_APP_ID"] = originalGitHubAppId;
}

function restoreGitHubAppInstallationId(): void {
  if (originalGitHubAppInstallationId === undefined) {
    delete Bun.env["GITHUB_APP_INSTALLATION_ID"];
    return;
  }
  Bun.env["GITHUB_APP_INSTALLATION_ID"] = originalGitHubAppInstallationId;
}

function restoreGitHubAppPrivateKey(): void {
  if (originalGitHubAppPrivateKey === undefined) {
    delete Bun.env["GITHUB_APP_PRIVATE_KEY"];
    return;
  }
  Bun.env["GITHUB_APP_PRIVATE_KEY"] = originalGitHubAppPrivateKey;
}

const fetchStub = Object.assign(
  async (
    _input: Parameters<typeof fetch>[0],
    _init?: Parameters<typeof fetch>[1],
  ) =>
    Response.json(
      {
        token: "test-github-app-token",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      {
        status: 201,
        headers: { "content-type": "application/json" },
      },
    ),
  { preconnect: originalFetch.preconnect },
);

const testAgentTaskActivities = createAgentTaskActivities(
  async (
    _input: AgentTaskInput,
    workdir: string,
  ): Promise<AgentTaskCommand> => {
    const outputPath = path.join(workdir, "agent-task-output.json");
    const code = [
      `await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({ markdown: "task complete", followUp: null, cancelCron: null, cancelReason: null }));`,
    ].join("\n");
    return {
      args: ["bun", "--eval", code],
      model: "test-model",
      outputPath,
      prompt: "Return a short report.",
    };
  },
);

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

const claudeInput: AgentTaskInput = {
  title: "Claude metric placement test",
  prompt: "Return a short report.",
  provider: "claude",
  mode: "report-only",
  allowSelfCancel: false,
  repo: {
    fullName: "shepherdjerred/monorepo",
    ref: "main",
  },
};

function claudeResultMessageCommand(
  resultMessage: Record<string, unknown>,
): (input: AgentTaskInput, workdir: string) => Promise<AgentTaskCommand> {
  return async (_input: AgentTaskInput, _workdir: string) => ({
    args: [
      "bun",
      "--eval",
      `console.log(${JSON.stringify(JSON.stringify(resultMessage))});`,
    ],
    model: "test-model",
    outputPath: undefined,
    prompt: "Return a short report.",
  });
}

describe("agentTaskActivities", () => {
  beforeAll(async () => {
    Bun.env["GITHUB_APP_ID"] = "12345";
    Bun.env["GITHUB_APP_INSTALLATION_ID"] = "67890";
    Bun.env["GITHUB_APP_PRIVATE_KEY"] = await testPrivateKeyPem();
    globalThis.fetch = fetchStub;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    restoreGitHubAppEnv();
  });

  it("records a successful run after agent output parses", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));

    const result = await testAgentTaskActivities.runAgentTask({
      input: baseInput,
      workdir,
    });

    expect(result.markdown).toBe("task complete");
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /agent_task_runs_total\{[^}]*provider="codex"[^}]*outcome="success"/,
    );
  });

  it("records a successful run after Claude structured_output parses", async () => {
    const claudeActivities = createAgentTaskActivities(
      claudeResultMessageCommand({
        type: "result",
        is_error: false,
        structured_output: { markdown: "claude task complete" },
      }),
    );
    const workdir = await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));

    const result = await claudeActivities.runAgentTask({
      input: claudeInput,
      workdir,
    });

    expect(result.markdown).toBe("claude task complete");
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /agent_task_runs_total\{[^}]*provider="claude"[^}]*outcome="success"/,
    );
  });

  it("throws a distinct error when claude reports is_error=true", async () => {
    const claudeActivities = createAgentTaskActivities(
      claudeResultMessageCommand({
        type: "result",
        is_error: true,
        result: "hit max turns",
      }),
    );
    const workdir = await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));

    let caught: unknown;
    try {
      await claudeActivities.runAgentTask({ input: claudeInput, workdir });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toMatch(/is_error=true/);
    expect(message).not.toMatch(/no structured output/);
  });

  it("redacts a distinct Codex API key", async () => {
    const codexApiKey = "codex-distinct-secret";
    const tokens = agentTaskSecretTokens("github-token", {
      CODEX_API_KEY: codexApiKey,
      OPENAI_API_KEY: "openai-distinct-secret",
    });

    expect(tokens).toContain(codexApiKey);
  });

  it("aliases OPENAI_API_KEY for Codex without overriding an explicit key", async () => {
    expect(
      envForProvider("codex", "github-token", {
        OPENAI_API_KEY: "openai-key",
      }),
    ).toEqual({
      OPENAI_API_KEY: "openai-key",
      CODEX_API_KEY: "openai-key",
      GH_TOKEN: "github-token",
    });
    expect(
      envForProvider("codex", "github-token", {
        OPENAI_API_KEY: "openai-key",
        CODEX_API_KEY: "codex-key",
      })["CODEX_API_KEY"],
    ).toBe("codex-key");
  });

  it("forwards the full worker env for Claude, minus ANTHROPIC_API_KEY and inherited GitHub creds", async () => {
    const environment = envForProvider("claude", "installation-token", {
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      // Operational secrets the homelab audit needs — must be FORWARDED so its
      // live Grafana/PagerDuty/ArgoCD/Bugsink/Cloudflare checks work.
      POSTAL_API_KEY: "postal-secret",
      GRAFANA_API_KEY: "grafana-secret",
      ARGOCD_AUTH_TOKEN: "argocd-secret",
      CLOUDFLARE_API_TOKEN: "cloudflare-secret",
      SAFE_VALUE: "forwarded",
      // Stripped: Claude bills the subscription, not the direct API.
      ANTHROPIC_API_KEY: "anthropic-key",
      // Stripped: never inherit the worker's GitHub creds; GH_TOKEN is re-minted.
      GH_TOKEN: "personal-token",
      GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token",
      GITHUB_APP_PRIVATE_KEY: "private-key",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      POSTAL_API_KEY: "postal-secret",
      GRAFANA_API_KEY: "grafana-secret",
      ARGOCD_AUTH_TOKEN: "argocd-secret",
      CLOUDFLARE_API_TOKEN: "cloudflare-secret",
      SAFE_VALUE: "forwarded",
      // The GitHub App installation token is injected explicitly, replacing any
      // inherited GitHub credential.
      GH_TOKEN: "installation-token",
    });
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
  });

  it("forwards the full worker env for Codex, replacing only inherited GitHub creds", async () => {
    const forwarded = {
      POSTAL_API_KEY: "postal-secret",
      PAGERDUTY_TOKEN: "pagerduty-secret",
      BUGSINK_TOKEN: "bugsink-secret",
      GRAFANA_API_KEY: "grafana-secret",
      ARGOCD_AUTH_TOKEN: "argocd-secret",
      CLOUDFLARE_API_TOKEN: "cloudflare-secret",
      // Codex keeps ANTHROPIC_API_KEY (only Claude strips it) and the other
      // provider's key — the full env is forwarded.
      ANTHROPIC_API_KEY: "anthropic-key",
      CLAUDE_CODE_OAUTH_TOKEN: "other-provider-key",
    };
    const environment = envForProvider("codex", "installation-token", {
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CODEX_API_KEY: "codex-key",
      ...forwarded,
      // Stripped: never inherit the worker's GitHub creds.
      GH_TOKEN: "personal-token",
      GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token",
      GITHUB_APP_PRIVATE_KEY: "private-key",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CODEX_API_KEY: "codex-key",
      ...forwarded,
      GH_TOKEN: "installation-token",
    });
    expect(environment).not.toHaveProperty("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
  });
});
