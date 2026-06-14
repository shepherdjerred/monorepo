import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { cleanupWorkdir, provisionWorkdir } from "#lib/pr-review-workdir.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import { emitOtel } from "#observability/log.ts";
import {
  agentSubprocessIdleSeconds,
  agentSubprocessSoftKillsTotal,
  alertRemediationDecisionsTotal,
  alertRemediationSubprocessDurationSeconds,
  alertRemediationSubprocessExitTotal,
} from "#observability/metrics.ts";
import { getTraceContext, withSpan } from "#observability/tracing.ts";
import { parseClaudeResultMessage } from "#shared/claude-result.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  AlertRemediationAgentPayloadSchema,
  AlertRemediationChildInputSchema,
  alertRemediationWorkflowId,
  sanitizeAlertIdPart,
  type AlertRemediationAgentPayload,
  type AlertRemediationChildInput,
  type AlertRemediationChildResult,
  type AlertRemediationCollectionResult,
  type AlertRemediationSweepInput,
  type NormalizedAlert,
} from "#shared/alert-remediation.ts";
import { runTrackedAgentSubprocess } from "#shared/agent-subprocess.ts";
import { collectAlertRemediationAlertsWithDeps } from "./alert-remediation-collect.ts";
import { buildAlertRemediationCommand } from "./alert-remediation-command.ts";
import { findExistingPr } from "./alert-remediation-find-pr.ts";
import { sendSweepEmail } from "./alert-remediation-email.ts";

const COMPONENT = "alert-remediation";
const HEARTBEAT_INTERVAL_MS = 10_000;
// Heartbeat target for `Context.current().info.workflowType` when we can't
// read the activity context (local script driver / unit test).
const DEFAULT_WORKFLOW_TYPE = "alertRemediationChildWorkflow";

export type PrepareAlertRemediationWorkdirInput = {
  input: AlertRemediationChildInput;
};

export type PrepareAlertRemediationWorkdirResult = {
  workdir: string;
};

export type RunAlertRemediationAgentInput = {
  input: AlertRemediationChildInput;
  workdir: string;
};

export type CleanupAlertRemediationWorkdirInput = {
  workdir: string;
};

function workflowFields(): Record<string, unknown> {
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      ...workflowExecutionContext(info),
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    return {};
  }
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const flow = workflowFields();
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...flow,
      ...getTraceContext(),
      ...fields,
    }),
  );
  emitOtel(level, message, { module: COMPONENT, ...flow, ...fields });
}

function captureWithContext(
  error: unknown,
  alert: NormalizedAlert | undefined,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    if (alert !== undefined) {
      scope.setTag("alert_source", alert.source);
      scope.setTag("alert_fingerprint", alert.fingerprint);
    }
    const flow = workflowFields();
    if (typeof flow["workflow"] === "string") {
      scope.setTag("workflow", flow["workflow"]);
    }
    if (typeof flow["activity"] === "string") {
      scope.setTag("activity", flow["activity"]);
    }
    scope.setContext("alertRemediation", { ...flow, ...extra });
    Sentry.captureException(error);
  });
}

function currentWorkflowType(): string {
  try {
    return Context.current().info.workflowType ?? DEFAULT_WORKFLOW_TYPE;
  } catch {
    return DEFAULT_WORKFLOW_TYPE;
  }
}

function startToCloseTimeoutMsOrUndefined(): number | undefined {
  try {
    return Context.current().info.startToCloseTimeoutMs;
  } catch {
    return undefined;
  }
}

async function collectAlerts(
  rawInput: AlertRemediationSweepInput,
): Promise<AlertRemediationCollectionResult> {
  return await collectAlertRemediationAlertsWithDeps(rawInput);
}

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo, extra] = fullName.split("/");
  if (owner === undefined || repo === undefined || extra !== undefined) {
    throw new Error(`Invalid repo fullName: ${fullName}`);
  }
  return { owner, repo };
}

function workflowId(): string {
  try {
    return (
      Context.current().info.workflowExecution?.workflowId ??
      `alert-remediation-local-${crypto.randomUUID()}`
    );
  } catch {
    return `alert-remediation-local-${crypto.randomUUID()}`;
  }
}

async function prepareWorkdir(
  input: PrepareAlertRemediationWorkdirInput,
): Promise<PrepareAlertRemediationWorkdirResult> {
  const parsed = AlertRemediationChildInputSchema.parse(input.input);
  const { owner, repo } = splitRepo(parsed.repo.fullName);
  const tokenResult = await createGitHubAppInstallationToken();
  const workdir = await provisionWorkdir({
    workflowId: `${workflowId()}-${sanitizeAlertIdPart(parsed.alert.fingerprint)}`,
    owner,
    repo,
    ref: parsed.repo.ref,
    env: { GH_TOKEN: tokenResult.token },
  });
  return { workdir };
}

function secretTokens(githubAppToken: string | undefined) {
  return [
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"],
    Bun.env["ANTHROPIC_API_KEY"],
    Bun.env["OPENAI_API_KEY"],
    Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"],
    Bun.env["GITHUB_APP_PRIVATE_KEY"],
    githubAppToken,
  ];
}

function agentEnv(githubAppToken: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (key === "ANTHROPIC_API_KEY") {
      continue;
    }
    if (
      key === "GH_TOKEN" ||
      key === "GITHUB_PERSONAL_ACCESS_TOKEN" ||
      key.startsWith("GITHUB_APP_")
    ) {
      continue;
    }
    env[key] = value;
  }
  env["GH_TOKEN"] = githubAppToken;
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_AUTHOR_NAME"] = env["GIT_AUTHOR_NAME"] ?? "Temporal Alert Bot";
  env["GIT_AUTHOR_EMAIL"] = env["GIT_AUTHOR_EMAIL"] ?? "ci@sjer.red";
  env["GIT_COMMITTER_NAME"] = env["GIT_COMMITTER_NAME"] ?? "Temporal Alert Bot";
  env["GIT_COMMITTER_EMAIL"] = env["GIT_COMMITTER_EMAIL"] ?? "ci@sjer.red";
  return env;
}

function parseAgentPayload(raw: string): AlertRemediationAgentPayload {
  try {
    const payload = AlertRemediationAgentPayloadSchema.parse(JSON.parse(raw));
    if (payload.outcome === "pr-created" && payload.prUrl === undefined) {
      throw new Error("pr-created output must include prUrl");
    }
    return payload;
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse alert-remediation JSON payload: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function heartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    jsonLog("info", "Skipping heartbeat outside Temporal activity");
  }
}

function activityCancellationSignalOrUndefined(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

async function runAgent(
  input: RunAlertRemediationAgentInput,
): Promise<AlertRemediationChildResult> {
  const parsed = AlertRemediationChildInputSchema.parse(input.input);
  const command = await buildAlertRemediationCommand(parsed, input.workdir);
  const workflowType = currentWorkflowType();

  return withSpan(
    "alert-remediation.run-agent",
    {
      "alert.source": parsed.alert.source,
      "alert.fingerprint": parsed.alert.fingerprint,
      "alert.title": parsed.alert.title,
      "agent.provider": parsed.provider,
      "agent.model": command.model,
      "agent.max_turns": parsed.maxTurns,
      "agent.workdir": input.workdir,
    },
    async (span) => {
      const tokenResult = await createGitHubAppInstallationToken();

      jsonLog("info", "Invoking alert-remediation agent", {
        phase: "spawn",
        source: parsed.alert.source,
        fingerprint: parsed.alert.fingerprint,
        model: command.model,
        maxTurns: parsed.maxTurns,
      });

      const result = await runTrackedAgentSubprocess(
        {
          command: command.args,
          cwd: input.workdir,
          env: agentEnv(tokenResult.token),
          redactTokens: secretTokens(tokenResult.token),
          startToCloseTimeoutMs: startToCloseTimeoutMsOrUndefined(),
          cancellationSignal: activityCancellationSignalOrUndefined(),
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          onHeartbeat: (beat) => {
            heartbeat({ phase: "agent", ...beat });
            jsonLog("info", "agent heartbeat", { phase: "agent", ...beat });
            span.addEvent("agent.heartbeat", {
              elapsedMs: beat.elapsedMs,
              idleMs: beat.idleMs,
            });
          },
          onSoftKill: (event) => {
            jsonLog("warning", "agent soft-kill", {
              phase: "soft-kill",
              ...event,
            });
            span.addEvent("agent.soft-kill", {
              elapsedMs: event.elapsedMs,
              idleMs: event.idleMs,
              maxIdleMs: event.maxIdleMs,
            });
            agentSubprocessSoftKillsTotal.inc({
              workflow_type: workflowType,
              reason: "pre_temporal_timeout",
            });
          },
          onStderrLine: (line) => {
            jsonLog("info", "agent stderr", { line });
          },
          onCancellation: (state) => {
            jsonLog(
              "warning",
              "Activity cancellation requested; killing subprocess",
              state,
            );
          },
        },
        redactSecrets,
      );

      agentSubprocessIdleSeconds.observe(
        { workflow_type: workflowType },
        result.maxIdleMs / 1000,
      );
      alertRemediationSubprocessDurationSeconds.observe(
        { model: command.model, exit_code: String(result.exitCode) },
        result.durationMs / 1000,
      );
      alertRemediationSubprocessExitTotal.inc({
        exit_code: String(result.exitCode),
        signal: result.signal,
      });
      span.setAttribute("agent.duration_ms", result.durationMs);
      span.setAttribute("agent.max_idle_ms", result.maxIdleMs);
      span.setAttribute("agent.exit_code", result.exitCode);
      span.setAttribute("agent.signal", result.signal);

      jsonLog("info", "agent exited", {
        phase: "exited",
        elapsedMs: result.durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        maxIdleMs: result.maxIdleMs,
      });

      if (result.exitCode !== 0) {
        // Tick the failed-outcome counter BEFORE throwing so the
        // `AlertRemediationDecisionsAllFailing` rule (which sums
        // `outcome="failed"`) actually sees the regression. Without this the
        // counter only ever ticks on the happy path and the rule is
        // permanently silent — the exact gap that hid the 14-day all-failed
        // regression this PR was opened to close.
        alertRemediationDecisionsTotal.inc({
          decision: "failed",
          outcome: "failed",
          source: parsed.alert.source,
        });
        const error = new Error(
          `alert-remediation agent exited with code ${String(result.exitCode)} (signal=${result.signal}, durationMs=${String(result.durationMs)})`,
        );
        captureWithContext(error, parsed.alert, {
          durationMs: result.durationMs,
          maxIdleMs: result.maxIdleMs,
          signal: result.signal,
          lastStderrLine: result.lastStderrLine,
        });
        throw error;
      }

      let payload: AlertRemediationAgentPayload;
      try {
        payload =
          parsed.provider === "claude"
            ? parseAgentPayload(
                parseClaudeResultMessage(result.stdout).result ?? "",
              )
            : parseAgentPayload(
                command.outputPath === undefined
                  ? ""
                  : await Bun.file(command.outputPath).text(),
              );
      } catch (error: unknown) {
        alertRemediationDecisionsTotal.inc({
          decision: "failed",
          outcome: "failed",
          source: parsed.alert.source,
        });
        captureWithContext(error, parsed.alert, {
          durationMs: result.durationMs,
          stage: "parse-output",
        });
        throw error;
      }

      alertRemediationDecisionsTotal.inc({
        decision: payload.decision,
        outcome: payload.outcome,
        source: parsed.alert.source,
      });
      span.setAttribute("alert.decision", payload.decision);
      span.setAttribute("alert.outcome", payload.outcome);
      jsonLog("info", "alert-remediation agent completed", {
        phase: "parse",
        source: parsed.alert.source,
        fingerprint: parsed.alert.fingerprint,
        outcome: payload.outcome,
        decision: payload.decision,
        durationMs: result.durationMs,
        maxIdleMs: result.maxIdleMs,
      });

      return {
        source: parsed.alert.source,
        fingerprint: parsed.alert.fingerprint,
        title: parsed.alert.title,
        outcome: payload.outcome,
        decision: payload.decision,
        reason: payload.reason,
        markdown: payload.markdown,
        prUrl: payload.prUrl,
        branchName: payload.branchName,
        verificationCommands: payload.verificationCommands,
      };
    },
  );
}

async function cleanup(
  input: CleanupAlertRemediationWorkdirInput,
): Promise<void> {
  await cleanupWorkdir(input.workdir);
}

export const alertRemediationActivities = {
  collectAlertRemediationAlerts: collectAlerts,
  findExistingAlertRemediationPr: findExistingPr,
  prepareAlertRemediationWorkdir: prepareWorkdir,
  runAlertRemediationAgent: runAgent,
  cleanupAlertRemediationWorkdir: cleanup,
  sendAlertRemediationSweepEmail: sendSweepEmail,
};

export type AlertRemediationActivities = typeof alertRemediationActivities;

export function childWorkflowIdForAlert(alert: NormalizedAlert): string {
  return alertRemediationWorkflowId(alert);
}
