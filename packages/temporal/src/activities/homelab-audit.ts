import { ApplicationFailure, Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import {
  homelabAuditEmailSentTotal,
  homelabAuditSubprocessDurationSeconds,
  homelabAuditSubprocessExitTotal,
  homelabAuditTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { emitOtel } from "#observability/log.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import {
  buildAuditPrompt,
  loadRunbook,
  type SectionsFilter,
} from "./homelab-audit-prompts.ts";
import { extractAuditSubjectCounts } from "#shared/markdown-to-html.ts";
import {
  createActivityReportEnvelope,
  deliverReport,
} from "./report-delivery.ts";
import { synthesizeHomelabAuditEvidence } from "./homelab-audit-synthesis.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  createAgentTaskSecretTokenState,
  envForTrustedAgent,
} from "./agent-task-env.ts";
import {
  activityCancellationSignalOrUndefined,
  startToCloseTimeoutMsOrUndefined,
} from "./agent-task-runtime.ts";
import {
  ClaudeAgentSdkRunError,
  runClaudeAgentSdk,
} from "./claude-agent-sdk-runner.ts";
import {
  archiveAuditBody,
  archiveAuditMetadata,
  type HomelabAuditArchiveBodyInput,
  type HomelabAuditArchiveBodyResult,
  type HomelabAuditArchiveMetadataInput,
  type HomelabAuditArchiveMetadataResult,
} from "./homelab-audit-archive.ts";
import {
  runAuditPreflight,
  type HomelabAuditPreflightResult,
} from "./homelab-audit-preflight.ts";

const COMPONENT = "homelab-audit";

const HEARTBEAT_INTERVAL_MS = 10_000;

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MAX_TURNS = 80;

// Audit hits a wide tool surface (kubectl, talosctl, toolkit, tofu, gh) so we
// allow Bash + Read + Grep + Glob + the GitHub MCP namespace if it's wired up
// later. The actual security bound is layered:
//   1. The Agent SDK env (subscription OAuth + audit creds, no direct API key).
//   2. The cluster RBAC bound to the temporal-worker SA — strict read-only via
//      `temporal-worker-audit-reader` (see homelab/.../audit-rbac.ts).
//   3. The prompt itself, which forbids state-mutating commands.
const ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "mcp__github__*",
] as const;

export type HomelabAuditAgentInput = {
  /** ISO date for the audit. Defaults to today (UTC) when undefined. */
  date?: string;
  /** Section IDs to include, or "all". */
  sections?: SectionsFilter;
  /** Preflight result block to inject before the output requirements. */
  toolingPreflightMarkdown?: string | undefined;
  /** Override the model (e.g. "claude-haiku-4-5-20251001" for cheap iteration). */
  model?: string;
  /** Override max-turns budget. */
  maxTurns?: number;
};

export type HomelabAuditAgentResult = {
  markdown: string;
  durationMs: number;
  numTurns: number | undefined;
  totalCostUsd: number | undefined;
  model: string;
};

export type HomelabAuditEmailInput = {
  date: string;
  markdown: string;
};

export type HomelabAuditEmailResult = {
  subject: string;
  messageId: string;
  recipientId: number | "unknown";
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const info = activityInfoOrUndefined();
  const base: Record<string, unknown> = {
    level,
    msg: message,
    component: COMPONENT,
    ...getTraceContext(),
    ...fields,
  };
  if (info !== undefined) {
    Object.assign(base, info);
  }
  console.warn(JSON.stringify(base));
  emitOtel(level, message, { module: COMPONENT, ...info, ...fields });
}

function activityInfoOrUndefined(): Record<string, unknown> | undefined {
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      ...workflowExecutionContext(info),
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    // Outside an activity (local dev script): no Temporal context to attach.
    return undefined;
  }
}

function captureWithContext(
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    const info = activityInfoOrUndefined();
    if (info !== undefined) {
      scope.setTag("workflow", String(info["workflow"]));
      scope.setTag("activity", String(info["activity"]));
    }
    scope.setContext("homelabAudit", { ...info, ...extra });
    Sentry.captureException(error);
  });
}

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Outside an activity (local dev script): heartbeats are a no-op.
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nonRetryableClaudeFailure(
  error: ClaudeAgentSdkRunError,
): ApplicationFailure {
  return ApplicationFailure.create({
    message: error.message,
    cause: error,
    nonRetryable: true,
    type: error.possiblyAppliedEffects
      ? "HomelabAuditPossiblyAppliedFailure"
      : "HomelabAuditBilledGenerationFailure",
  });
}

async function runAuditAgent(
  input: HomelabAuditAgentInput,
): Promise<HomelabAuditAgentResult> {
  const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (claudeToken === undefined || claudeToken === "") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required");
  }

  const date = input.date ?? todayIsoDate();
  const sections = input.sections ?? "all";
  const model = input.model ?? DEFAULT_MODEL;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const runbook = await loadRunbook();
  const prompt = buildAuditPrompt({
    date,
    runbook,
    sections,
    toolingPreflightMarkdown: input.toolingPreflightMarkdown,
  });

  jsonLog("info", "Invoking Claude Agent SDK for homelab audit", {
    date,
    sections,
    model,
    maxTurns,
  });

  const githubTokenResult = await createGitHubAppInstallationToken();
  const secretState = await createAgentTaskSecretTokenState(
    githubTokenResult.token,
  );
  const activitySignal = activityCancellationSignalOrUndefined();
  const timeoutController = new AbortController();
  const timeoutMs = startToCloseTimeoutMsOrUndefined();
  const timeoutTimer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => {
            timeoutController.abort(
              new Error(
                "Homelab audit stopped before Temporal start-to-close timeout",
              ),
            );
          },
          Math.max(1, timeoutMs - 15_000),
        );
  const signal = AbortSignal.any([
    timeoutController.signal,
    ...(activitySignal === undefined ? [] : [activitySignal]),
  ]);
  const startMs = Date.now();
  let eventCount = 0;
  const heartbeat = setInterval(() => {
    safeHeartbeat({
      phase: "claude-agent-sdk",
      elapsedMs: Date.now() - startMs,
      eventCount,
    });
  }, HEARTBEAT_INTERVAL_MS);

  let result;
  try {
    result = await runClaudeAgentSdk({
      service: "temporal",
      callSite: "homelab-audit",
      prompt,
      model,
      maxTurns,
      cwd: process.cwd(),
      allowedTools: ALLOWED_TOOLS,
      env: envForTrustedAgent({
        CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
        GH_TOKEN: githubTokenResult.token,
      }),
      signal,
      redactTokens: secretState.tokens,
      beforeEvent: async () => {
        try {
          await secretState.refresh();
          return true;
        } catch {
          return false;
        }
      },
      onEvent: (event) => {
        eventCount += 1;
        safeHeartbeat({
          phase: "claude-agent-sdk",
          elapsedMs: event.elapsedMs,
          eventCount,
          eventType: event.type,
        });
        jsonLog("info", "homelab audit agent event", {
          eventType: event.type,
          elapsedMs: event.elapsedMs,
        });
      },
    });
  } catch (error: unknown) {
    homelabAuditSubprocessExitTotal.inc({ exit_code: "sdk_failed" });
    const classified =
      error instanceof ClaudeAgentSdkRunError && error.generationStarted
        ? nonRetryableClaudeFailure(error)
        : error;
    captureWithContext(classified, {
      model,
      durationMs: Date.now() - startMs,
      runtime: "claude_agent_sdk",
      generationStarted:
        error instanceof ClaudeAgentSdkRunError
          ? error.generationStarted
          : undefined,
      possiblyAppliedEffects:
        error instanceof ClaudeAgentSdkRunError
          ? error.possiblyAppliedEffects
          : undefined,
    });
    throw classified;
  } finally {
    clearInterval(heartbeat);
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }
  }

  const markdown = result.resultText.trim();
  if (markdown.length === 0) {
    const error = ApplicationFailure.nonRetryable(
      "Claude Agent SDK returned an empty homelab audit after a completed generation",
      "HomelabAuditOutputContractFailure",
    );
    captureWithContext(error, {
      durationMs: result.durationMs,
      sessionId: result.sessionId,
    });
    throw error;
  }

  homelabAuditSubprocessDurationSeconds.observe(
    { model, exit_code: "sdk_success" },
    result.durationMs / 1000,
  );
  homelabAuditSubprocessExitTotal.inc({ exit_code: "sdk_success" });
  homelabAuditTokensTotal.inc(
    { model, direction: "input" },
    result.usage.inputTokens,
  );
  homelabAuditTokensTotal.inc(
    { model, direction: "output" },
    result.usage.outputTokens,
  );
  homelabAuditTokensTotal.inc(
    { model, direction: "cache_create" },
    result.usage.cacheCreationInputTokens,
  );
  homelabAuditTokensTotal.inc(
    { model, direction: "cache_read" },
    result.usage.cacheReadInputTokens,
  );

  jsonLog("info", "homelab audit agent completed", {
    runtime: "claude_agent_sdk",
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    sessionId: result.sessionId,
    markdownLength: markdown.length,
  });

  return {
    markdown,
    durationMs: result.durationMs,
    numTurns: result.numTurns,
    totalCostUsd: result.costUsd,
    model,
  };
}
async function sendAuditEmail(
  input: HomelabAuditEmailInput,
): Promise<HomelabAuditEmailResult> {
  const counts = extractAuditSubjectCounts(input.markdown);
  try {
    const report = createActivityReportEnvelope({
      reportType: "homelab-audit",
      title: `Homelab audit ${input.date}`,
      scheduleId: "homelab-audit-daily",
      startedAt: new Date().toISOString(),
      execution: "partial",
      verdict: "inconclusive",
      headline:
        counts === undefined
          ? "Legacy audit completed without declared check coverage."
          : `Legacy audit reported ${counts.red.toString()} red, ${counts.yellow.toString()} yellow, and ${counts.openAlerts.toString()} open alert occurrences.`,
      checks: [
        {
          id: "legacy-coverage",
          label: "Legacy undeclared audit coverage",
          required: true,
          status: "failed",
          summary:
            "The legacy markdown result has no per-check evidence contract.",
          evidenceReceiptIds: ["legacy-markdown"],
        },
      ],
      evidence: [
        {
          id: "legacy-markdown",
          source: "legacy homelab audit agent",
          observedAt: new Date().toISOString(),
          status: "success",
          excerpt: input.markdown.slice(0, 2000),
        },
      ],
      findings: [],
      limitations: [
        "Legacy result replay: coverage and individual claims cannot be verified against declared receipts.",
      ],
      actions: [],
      provenance: { source: "legacy homelab audit workflow" },
    });
    const result = await deliverReport(report);
    homelabAuditEmailSentTotal.inc({ outcome: "success" });
    jsonLog("info", "Homelab audit email accepted by Postal", {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
    });
    return {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
    };
  } catch (error: unknown) {
    homelabAuditEmailSentTotal.inc({ outcome: "failure" });
    captureWithContext(error, { reportType: "homelab-audit" });
    throw error;
  }
}

export type HomelabAuditActivities = typeof homelabAuditActivities;

export const homelabAuditActivities = {
  async runHomelabAuditPreflight(): Promise<HomelabAuditPreflightResult> {
    return runAuditPreflight();
  },
  async runHomelabAuditAgent(
    input: HomelabAuditAgentInput,
  ): Promise<HomelabAuditAgentResult> {
    return runAuditAgent(input);
  },
  async archiveHomelabAuditBody(
    input: HomelabAuditArchiveBodyInput,
  ): Promise<HomelabAuditArchiveBodyResult> {
    return archiveAuditBody(input);
  },
  async sendHomelabAuditEmail(
    input: HomelabAuditEmailInput,
  ): Promise<HomelabAuditEmailResult> {
    return sendAuditEmail(input);
  },
  async archiveHomelabAuditMetadata(
    input: HomelabAuditArchiveMetadataInput,
  ): Promise<HomelabAuditArchiveMetadataResult> {
    return archiveAuditMetadata(input);
  },
  synthesizeHomelabAuditEvidence,
};
