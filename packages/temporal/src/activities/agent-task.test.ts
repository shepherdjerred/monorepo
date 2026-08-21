import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationFailure } from "@temporalio/activity";
import { register } from "#observability/metrics.ts";
import type { AgentTaskInput, AgentTaskProvider } from "#shared/agent-task.ts";
import { agentTaskCollectorReceiptId } from "#shared/agent-task-evidence-contract.ts";
import type { ReportEvidenceReceiptV1 } from "#shared/report.ts";
import { redactSecrets } from "#shared/redact.ts";
import { createAgentTaskActivities } from "./agent-task.ts";
import {
  AgentTaskSdkExecutionError,
  type AgentTaskSdkResult,
  type AgentTaskSdkRunInput,
} from "./agent-task-sdk.ts";
import {
  agentTaskSecretTokens,
  envForEvidenceCollector,
  envForProvider,
  envForTrustedAgent,
  readAgentTaskMountedSecretTokens,
} from "./agent-task-env.ts";

type SdkRunner = (input: AgentTaskSdkRunInput) => Promise<AgentTaskSdkResult>;

function sdkResult(
  provider: AgentTaskProvider,
  output: unknown,
  evidenceEvents: unknown[] = [],
): AgentTaskSdkResult {
  return {
    output,
    finalText: typeof output === "string" ? output : JSON.stringify(output),
    evidenceEvents,
    provider,
    model: "test-model",
    durationMs: 25,
    sessionId: "test-session",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 0,
      outputTokens: 5,
      reasoningTokens: 1,
    },
    costUsd: provider === "claude" ? 0.01 : undefined,
    eventCount: 2,
    firstEventLatencyMs: 5,
    maxIdleMs: 10,
    generationStarted: true,
    possiblyAppliedEffects: false,
  };
}

function createTestAgentTaskActivities(
  sdkRunner: SdkRunner,
  evidenceCollector: (
    input: AgentTaskInput,
    workdir: string,
  ) => Promise<ReportEvidenceReceiptV1[]> = () => Promise.resolve([]),
) {
  return createAgentTaskActivities(sdkRunner, evidenceCollector);
}

async function testWorkdir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "agent-task-test-"));
}

// runAgent builds a real provider environment, which fails fast without the
// provider's subscription credential.
const originalClaudeCredential = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
const originalCodexCredential = Bun.env["CODEX_ACCESS_TOKEN"];

beforeAll(() => {
  Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-claude-subscription-credential";
  Bun.env["CODEX_ACCESS_TOKEN"] = "test-codex-subscription-credential";
});

afterAll(() => {
  if (originalClaudeCredential === undefined) {
    delete Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  } else {
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = originalClaudeCredential;
  }
  if (originalCodexCredential === undefined) {
    delete Bun.env["CODEX_ACCESS_TOKEN"];
  } else {
    Bun.env["CODEX_ACCESS_TOKEN"] = originalCodexCredential;
  }
});

const baseInput: AgentTaskInput = {
  title: "Metric placement test",
  prompt: "Return a short report.",
  provider: "codex",
  mode: "report-only",
  allowSelfCancel: false,
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
};

const claudeInput: AgentTaskInput = {
  title: "Claude metric placement test",
  prompt: "Return a short report.",
  provider: "claude",
  mode: "report-only",
  allowSelfCancel: false,
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
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
  provider: "codex",
  mode: "report-only",
  allowSelfCancel: false,
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
};

describe("agentTaskActivities", () => {
  it("records a successful run after agent output parses", async () => {
    const activities = createTestAgentTaskActivities((input) =>
      Promise.resolve(
        sdkResult(input.config.provider, {
          markdown: "task complete",
          followUp: null,
          cancelCron: null,
          cancelReason: null,
        }),
      ),
    );

    const result = await activities.runAgentTask({
      input: baseInput,
      workdir: await testWorkdir(),
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

  it("records a successful run after Claude structured output parses", async () => {
    const activities = createTestAgentTaskActivities(() =>
      Promise.resolve(
        sdkResult("claude", { markdown: "claude task complete" }),
      ),
    );

    const result = await activities.runAgentTask({
      input: claudeInput,
      workdir: await testWorkdir(),
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
    const allowedToolsByPhase = new Map<string, readonly string[]>();
    const collectorReceiptId = agentTaskCollectorReceiptId(
      "service-health",
      "service-health-command",
    );
    const commandEvent = {
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
    const activities = createTestAgentTaskActivities(
      (input) => {
        const phase = input.config.phase;
        phases.push(phase);
        allowedToolsByPhase.set(phase, input.config.allowedTools);
        const finalizing = phase === "finalization";
        if (finalizing) {
          expect(input.config.prompt).toContain("Captured evidence catalog:");
          expect(input.config.prompt).toContain(collectorReceiptId);
          expect(input.config.prompt).toContain(
            "Preliminary service assessment.",
          );
        }
        return Promise.resolve(
          sdkResult(
            "codex",
            {
              headline: finalizing
                ? "The service is healthy."
                : "Preliminary service assessment.",
              checks: [
                {
                  id: "service-health",
                  status: "passed",
                  summary: "The command succeeded.",
                  evidenceReceiptIds: finalizing ? [collectorReceiptId] : [],
                },
              ],
              findings: [],
              limitations: [],
              actions: [],
              synthesis: null,
              followUp: null,
              retirementRecommendation: null,
            },
            finalizing ? [] : [commandEvent],
          ),
        );
      },
      () =>
        Promise.resolve([
          {
            id: collectorReceiptId,
            source: "declared-command:service-health-command",
            origin: "declared-collector",
            observedAt: "2026-08-10T12:00:00.000Z",
            status: "success",
            semanticStatus: "passed",
            command: '["service-health","--json"]',
            exitCode: 0,
            excerpt: '{"healthy":true}',
          },
        ]),
    );
    const workdir = await testWorkdir();

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
    // Finalization may only reason over the captured catalog, so it gets no tools.
    expect(allowedToolsByPhase.get("finalization")).toEqual([]);
    expect(allowedToolsByPhase.get("investigation")?.length).toBeGreaterThan(0);
    expect(result.payload.checks[0]?.evidenceReceiptIds).toEqual([
      collectorReceiptId,
    ]);
    expect(result.evidence[0]).toMatchObject({
      id: "command-1",
      origin: "provider",
      status: "success",
      command: "service-health --json",
    });
    expect(result.evidence[1]).toMatchObject({
      id: collectorReceiptId,
      origin: "declared-collector",
      status: "success",
    });
  });
});

describe("agent task runtime support", () => {
  it("makes a completed SDK failure non-retryable", async () => {
    const activities = createTestAgentTaskActivities(() => {
      throw new AgentTaskSdkExecutionError("hit max turns", {
        provider: "claude",
        generationStarted: true,
        possiblyAppliedEffects: false,
        authOrQuotaFailure: false,
      });
    });

    let caught: unknown;
    try {
      await activities.runAgentTask({
        input: claudeInput,
        workdir: await testWorkdir(),
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApplicationFailure);
    expect(
      caught instanceof ApplicationFailure ? caught.nonRetryable : false,
    ).toBe(true);
    expect(caught instanceof Error ? caught.message : "").toContain(
      "hit max turns",
    );
  });

  it("never retries an agent whose structured output violates the contract", async () => {
    const activities = createTestAgentTaskActivities(() =>
      Promise.resolve(sdkResult("claude", { markdown: "" })),
    );

    let caught: unknown;
    try {
      await activities.runAgentTask({
        input: claudeInput,
        workdir: await testWorkdir(),
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApplicationFailure);
    expect(
      caught instanceof ApplicationFailure ? caught.nonRetryable : false,
    ).toBe(true);
    expect(caught instanceof ApplicationFailure ? caught.type : undefined).toBe(
      "AgentSdkOutputContractFailure",
    );
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /agent_task_output_contract_failures_total\{[^}]*reason="invalid-structured-output"/,
    );
  });

  it("reports a missing structured output as a contract failure, never as prose", async () => {
    const activities = createTestAgentTaskActivities(() =>
      Promise.resolve(sdkResult("claude", undefined)),
    );

    let caught: unknown;
    try {
      await activities.runAgentTask({
        input: claudeInput,
        workdir: await testWorkdir(),
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught instanceof Error ? caught.message : "").toContain(
      "missing-structured-output",
    );
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /agent_task_output_contract_failures_total\{[^}]*reason="missing-structured-output"/,
    );
  });

  it("redacts native SDK subscription tokens and operational credentials", () => {
    const codexAccessToken = "codex-distinct-secret";
    const tokens = agentTaskSecretTokens("github-token", {
      CODEX_ACCESS_TOKEN: codexAccessToken,
      HA_TOKEN: "ha-distinct-secret",
      AWS_SECRET_ACCESS_KEY: "aws-distinct-secret",
      AGENT_TASK_API_TOKEN: "agent-task-distinct-secret",
      GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
      XCODE_CLOUD_WEBHOOK_TOKEN: "xcode-distinct-secret",
      DATABASE_URL: "postgres://user:database-secret@example",
      SENTRY_DSN:
        "https://sentry-public@sentry.example/42?token=sentry-query-secret",
    });

    expect(tokens).toContain(codexAccessToken);
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
});

describe("agent task environment boundary", () => {
  it("gives declared collectors no provider or delivery credentials", () => {
    expect(
      envForEvidenceCollector("/tmp/collector-home", {
        PATH: "/usr/bin",
        PROMETHEUS_URL: "http://prometheus.local",
        CLAUDE_CODE_OAUTH_TOKEN: "claude-secret",
        CODEX_ACCESS_TOKEN: "codex-secret",
        POSTAL_API_KEY: "postal-secret",
        AGENT_TASK_API_TOKEN: "api-secret",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      PROMETHEUS_URL: "http://prometheus.local",
      HOME: "/tmp/collector-home",
    });
  });

  it("allows only Claude auth and non-secret read-only runtime configuration", () => {
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
      CODEX_ACCESS_TOKEN: "other-provider-credential",
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
    expect(environment).not.toHaveProperty("CODEX_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("POSTAL_API_KEY");
    expect(environment).not.toHaveProperty("POSTAL_HOST");
    expect(environment).not.toHaveProperty("RECIPIENT_EMAIL");
    expect(environment).not.toHaveProperty("SENDER_EMAIL");
    expect(environment).not.toHaveProperty("AGENT_TASK_API_TOKEN");
    expect(environment).not.toHaveProperty("GH_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("GRAFANA_API_KEY");
    expect(environment).not.toHaveProperty("ARGOCD_AUTH_TOKEN");
    expect(environment).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(environment).not.toHaveProperty("SAFE_VALUE");
  });

  it("allows only Codex auth and non-secret read-only runtime configuration", () => {
    const environment = envForProvider("codex", "/tmp/agent-home", {
      PATH: "/usr/bin",
      HOME: "/home/worker",
      CODEX_ACCESS_TOKEN: "codex-credential",
      ALERT_DASHBOARD_URL: "http://alerts.local",
      POSTAL_API_KEY: "postal-secret",
      SENDER_EMAIL: "sender@example.test",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      BUGSINK_TOKEN: "bugsink-secret",
      GRAFANA_API_KEY: "grafana-secret",
      CLAUDE_CODE_OAUTH_TOKEN: "other-provider-credential",
      GH_TOKEN: "personal-token",
      GITHUB_APP_PRIVATE_KEY: "private-key",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/agent-home",
      CODEX_ACCESS_TOKEN: "codex-credential",
      ALERT_DASHBOARD_URL: "http://alerts.local",
    });
    expect(environment).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(environment).not.toHaveProperty("GH_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("POSTAL_API_KEY");
    expect(environment).not.toHaveProperty("SENDER_EMAIL");
    expect(environment).not.toHaveProperty("GITHUB_WEBHOOK_SECRET");
    expect(environment).not.toHaveProperty("BUGSINK_TOKEN");
    expect(environment).not.toHaveProperty("GRAFANA_API_KEY");
  });

  it("gives a trusted agent its operational credentials but only its own provider credential", () => {
    const environment = envForTrustedAgent(
      { CLAUDE_CODE_OAUTH_TOKEN: "claude-credential", GH_TOKEN: "minted" },
      {
        PATH: "/usr/bin",
        // The audit genuinely needs these to inspect live state.
        GRAFANA_API_KEY: "grafana-secret",
        ARGOCD_AUTH_TOKEN: "argocd-secret",
        BUGSINK_TOKEN: "bugsink-secret",
        TALOSCONFIG: "/etc/talos/config",
        // An unrelated provider credential the worker happens to hold. A
        // trusted agent has Bash, so inheriting this would make it
        // exfiltratable by a mistaken or injected command.
        CODEX_ACCESS_TOKEN: "codex-credential",
        OPENROUTER_API_KEY: "openrouter-key",
        ANTHROPIC_API_KEY: "anthropic-key",
        // Replaced by the minted installation token.
        GH_TOKEN: "worker-token",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        // Delivery stays in the parent.
        POSTAL_API_KEY: "postal-secret",
        RECIPIENT_EMAIL: "recipient@example.test",
      },
    );

    expect(environment).toEqual({
      PATH: "/usr/bin",
      GRAFANA_API_KEY: "grafana-secret",
      ARGOCD_AUTH_TOKEN: "argocd-secret",
      BUGSINK_TOKEN: "bugsink-secret",
      TALOSCONFIG: "/etc/talos/config",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-credential",
      GH_TOKEN: "minted",
    });
    expect(environment).not.toHaveProperty("CODEX_ACCESS_TOKEN");
    expect(environment).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("GITHUB_APP_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("POSTAL_API_KEY");
    expect(environment).not.toHaveProperty("RECIPIENT_EMAIL");
  });

  it("gives a trusted Codex agent no Claude subscription credential", () => {
    expect(
      envForTrustedAgent(
        { CODEX_ACCESS_TOKEN: "codex-credential" },
        {
          PATH: "/usr/bin",
          CLAUDE_CODE_OAUTH_TOKEN: "claude-credential",
          CODEX_ACCESS_TOKEN: "worker-codex-credential",
        },
      ),
    ).toEqual({ PATH: "/usr/bin", CODEX_ACCESS_TOKEN: "codex-credential" });
  });

  it("fails fast when the provider's subscription credential is missing", () => {
    expect(() =>
      envForProvider("codex", "/tmp/agent-home", { PATH: "/usr/bin" }),
    ).toThrow("CODEX_ACCESS_TOKEN is required for codex agent tasks");
  });
});
