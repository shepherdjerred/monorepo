import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { register } from "#observability/metrics.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import { redactSecrets } from "#shared/redact.ts";
import type { AgentTaskCommand } from "./agent-task-command.ts";
import { createAgentTaskActivities } from "./agent-task.ts";
import {
  agentTaskSecretTokens,
  envForProvider,
  readAgentTaskMountedSecretTokens,
} from "./agent-task-env.ts";

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

const v2Input: AgentTaskInput = {
  contractVersion: 2,
  title: "Two-phase evidence test",
  prompt: "Check the current service state.",
  checks: [
    {
      id: "service-health",
      label: "Service health",
      required: true,
      evidenceRequirement: "A successful command response.",
    },
  ],
  provider: "codex",
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
  it("records a successful run after agent output parses", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));

    const result = await testAgentTaskActivities.runAgentTask({
      input: baseInput,
      workdir,
    });

    if (result.contractVersion !== 1) {
      throw new TypeError("expected legacy contract result");
    }
    expect(result.payload.markdown).toBe("task complete");
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

    if (result.contractVersion !== 1) {
      throw new TypeError("expected legacy contract result");
    }
    expect(result.payload.markdown).toBe("claude task complete");
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /agent_task_runs_total\{[^}]*provider="claude"[^}]*outcome="success"/,
    );
  });

  it("finalizes v2 output against receipts captured during investigation", async () => {
    const phases: string[] = [];
    const activities = createAgentTaskActivities(
      async (_input, workdir, phase): Promise<AgentTaskCommand> => {
        if (phase === undefined) {
          throw new Error("two-phase test requires an explicit phase");
        }
        phases.push(phase.kind);
        const outputPath = path.join(workdir, `${phase.kind}.json`);
        const evidenceReceiptIds =
          phase.kind === "finalization" ? ["command-1"] : [];
        if (phase.kind === "finalization") {
          expect(phase.evidence.map((receipt) => receipt.id)).toEqual([
            "command-1",
          ]);
          expect(phase.preliminary.headline).toBe(
            "Preliminary service assessment.",
          );
        }
        const payload = {
          headline:
            phase.kind === "finalization"
              ? "The service is healthy."
              : "Preliminary service assessment.",
          checks: [
            {
              id: "service-health",
              status: "passed",
              summary: "The command succeeded.",
              evidenceReceiptIds,
            },
          ],
          findings: [],
          limitations: [],
          actions: [],
          synthesis: null,
          followUp: null,
          retirementRecommendation: null,
        };
        const event = {
          type: "item.completed",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "service-health --json",
            aggregated_output: '{"healthy":true}',
            exit_code: 0,
            status: "completed",
          },
        };
        const code = [
          ...(phase.kind === "investigation"
            ? [`console.log(${JSON.stringify(JSON.stringify(event))});`]
            : []),
          `await Bun.write(${JSON.stringify(outputPath)}, ${JSON.stringify(JSON.stringify(payload))});`,
        ].join("\n");
        return {
          args: ["bun", "--eval", code],
          model: "test-model",
          outputPath,
          prompt: `${phase.kind} prompt`,
        };
      },
    );
    const workdir = await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));

    const investigation = await activities.investigateAgentTask({
      input: v2Input,
      workdir,
    });
    const result = await activities.finalizeAgentTask({
      input: v2Input,
      workdir,
      investigation,
    });

    expect(phases).toEqual(["investigation", "finalization"]);
    expect(result.payload.checks[0]?.evidenceReceiptIds).toEqual(["command-1"]);
    expect(result.evidence[0]).toMatchObject({
      id: "command-1",
      status: "success",
      command: "service-health --json",
    });
  });
});

describe("agent task runtime support", () => {
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
      HA_TOKEN: "ha-distinct-secret",
      AWS_SECRET_ACCESS_KEY: "aws-distinct-secret",
      AGENT_TASK_API_TOKEN: "agent-task-distinct-secret",
      GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
      XCODE_CLOUD_WEBHOOK_TOKEN: "xcode-distinct-secret",
      DATABASE_URL: "postgres://user:database-secret@example",
      SENTRY_DSN:
        "https://sentry-public@sentry.example/42?token=sentry-query-secret",
    });

    expect(tokens).toContain(codexApiKey);
    expect(tokens).toContain("ha-distinct-secret");
    expect(tokens).toContain("aws-distinct-secret");
    expect(tokens).toContain("agent-task-distinct-secret");
    expect(tokens).toContain("github-webhook-secret");
    expect(tokens).toContain("xcode-distinct-secret");
    expect(tokens).toContain("postgres://user:database-secret@example");
    expect(tokens).toContain("database-secret");
    expect(tokens).toContain("sentry-public");
    expect(tokens).toContain("sentry-query-secret");
  });

  it("includes mounted service-account credentials in diagnostic redaction", async () => {
    const tokenPath = path.join(
      os.tmpdir(),
      `agent-task-service-account-${crypto.randomUUID()}`,
    );
    await Bun.write(tokenPath, "mounted-service-account-token\n");

    try {
      const mountedTokens = await readAgentTaskMountedSecretTokens([tokenPath]);
      const tokens = agentTaskSecretTokens("github-token", {}, mountedTokens);

      expect(tokens).toContain("mounted-service-account-token");
      expect(
        redactSecrets("final prose: mounted-service-account-token", tokens),
      ).toBe("final prose: ***");
    } finally {
      await rm(tokenPath);
    }
  });

  it("aliases OPENAI_API_KEY for Codex without overriding an explicit key", async () => {
    expect(
      envForProvider("codex", "/tmp/agent-home", {
        OPENAI_API_KEY: "openai-key",
      }),
    ).toEqual({
      OPENAI_API_KEY: "openai-key",
      CODEX_API_KEY: "openai-key",
      HOME: "/tmp/agent-home",
    });
    expect(
      envForProvider("codex", "/tmp/agent-home", {
        OPENAI_API_KEY: "openai-key",
        CODEX_API_KEY: "codex-key",
      })["CODEX_API_KEY"],
    ).toBe("codex-key");
  });

  it("allows only Claude auth and non-secret read-only runtime configuration", async () => {
    const environment = envForProvider("claude", "/tmp/agent-home", {
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      PROMETHEUS_URL: "http://prometheus.local",
      ALERT_DASHBOARD_URL: "http://alerts.local",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
      POSTAL_API_KEY: "postal-secret",
      POSTAL_HOST: "https://postal.example.test",
      RECIPIENT_EMAIL: "recipient@example.test",
      SENDER_EMAIL: "sender@example.test",
      AGENT_TASK_API_TOKEN: "agent-task-api-secret",
      GRAFANA_API_KEY: "grafana-secret",
      ARGOCD_AUTH_TOKEN: "argocd-secret",
      CLOUDFLARE_API_TOKEN: "cloudflare-secret",
      SAFE_VALUE: "not-allowlisted",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "other-provider-key",
      CODEX_API_KEY: "other-provider-key",
      GH_TOKEN: "personal-token",
      GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token",
      GITHUB_APP_PRIVATE_KEY: "private-key",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/agent-home",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      PROMETHEUS_URL: "http://prometheus.local",
      ALERT_DASHBOARD_URL: "http://alerts.local",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
    });
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("POSTAL_API_KEY");
    expect(environment).not.toHaveProperty("POSTAL_HOST");
    expect(environment).not.toHaveProperty("RECIPIENT_EMAIL");
    expect(environment).not.toHaveProperty("SENDER_EMAIL");
    expect(environment).not.toHaveProperty("AGENT_TASK_API_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("CODEX_API_KEY");
    expect(environment).not.toHaveProperty("GRAFANA_API_KEY");
    expect(environment).not.toHaveProperty("ARGOCD_AUTH_TOKEN");
    expect(environment).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(environment).not.toHaveProperty("SAFE_VALUE");
  });

  it("allows only Codex auth and non-secret read-only runtime configuration", async () => {
    const environment = envForProvider("codex", "/tmp/agent-home", {
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CODEX_API_KEY: "codex-key",
      OPENAI_API_KEY: "openai-key",
      ALERT_DASHBOARD_URL: "http://alerts.local",
      POSTAL_API_KEY: "postal-secret",
      SENDER_EMAIL: "sender@example.test",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      BUGSINK_TOKEN: "bugsink-secret",
      GRAFANA_API_KEY: "grafana-secret",
      ARGOCD_AUTH_TOKEN: "argocd-secret",
      CLOUDFLARE_API_TOKEN: "cloudflare-secret",
      ANTHROPIC_API_KEY: "anthropic-key",
      CLAUDE_CODE_OAUTH_TOKEN: "other-provider-key",
      GH_TOKEN: "personal-token",
      GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token",
      GITHUB_APP_PRIVATE_KEY: "private-key",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/agent-home",
      CODEX_API_KEY: "codex-key",
      OPENAI_API_KEY: "openai-key",
      ALERT_DASHBOARD_URL: "http://alerts.local",
    });
    expect(environment).not.toHaveProperty("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("POSTAL_API_KEY");
    expect(environment).not.toHaveProperty("SENDER_EMAIL");
    expect(environment).not.toHaveProperty("GITHUB_WEBHOOK_SECRET");
    expect(environment).not.toHaveProperty("BUGSINK_TOKEN");
    expect(environment).not.toHaveProperty("GRAFANA_API_KEY");
    expect(environment).not.toHaveProperty("ARGOCD_AUTH_TOKEN");
    expect(environment).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(environment).not.toHaveProperty("GH_TOKEN");
  });
});
