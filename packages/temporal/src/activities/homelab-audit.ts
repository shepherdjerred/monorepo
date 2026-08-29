import { ApplicationFailure } from "@temporalio/activity";
import {
  homelabAuditEmailSentTotal,
  homelabAuditSubprocessDurationSeconds,
  homelabAuditSubprocessExitTotal,
  homelabAuditTokensTotal,
} from "#observability/metrics.ts";
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
  CodexAgentSdkRunError,
  runCodexAgentSdk,
} from "./codex-agent-sdk-runner.ts";
import {
  archiveAuditBody,
  archiveAuditMetadata,
  type HomelabAuditArchiveBodyInput,
  type HomelabAuditArchiveBodyResult,
  type HomelabAuditArchiveMetadataInput,
  type HomelabAuditArchiveMetadataResult,
} from "./homelab-audit-archive.ts";
import type {
  HomelabAuditAgentResult,
  HomelabAuditEmailInput,
  HomelabAuditEmailResult,
} from "#shared/homelab-audit-types.ts";
import {
  runAuditPreflight,
  type HomelabAuditPreflightResult,
} from "./homelab-audit-preflight.ts";
import { createActivityObservability } from "./activity-observability.ts";

const COMPONENT = "homelab-audit";

const HEARTBEAT_INTERVAL_MS = 10_000;

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_MAX_TURNS = 80;

const { jsonLog, captureWithContext, safeHeartbeat } =
  createActivityObservability(COMPONENT, "homelabAudit");

// Audit hits a wide tool surface (kubectl, talosctl, toolkit, tofu, gh). The
// actual security bound is layered:
//   1. The Agent SDK env (OpenRouter + audit creds).
//   2. The cluster RBAC bound to the temporal-worker SA — strict read-only via
//      `temporal-worker-audit-reader` (see homelab/.../audit-rbac.ts).
//   3. The prompt itself, which forbids state-mutating commands.
export type HomelabAuditAgentInput = {
  /** ISO date for the audit. Defaults to today (UTC) when undefined. */
  date?: string;
  /** Section IDs to include, or "all". */
  sections?: SectionsFilter;
  /** Preflight result block to inject before the output requirements. */
  toolingPreflightMarkdown?: string | undefined;
  /** Override the stable catalog model ID for local iteration. */
  model?: string;
  /** Override max-turns budget. */
  maxTurns?: number;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nonRetryableCodexFailure(
  error: CodexAgentSdkRunError,
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
  const openRouterApiKey = Bun.env["OPENROUTER_API_KEY"];
  if (openRouterApiKey === undefined || openRouterApiKey === "") {
    throw new Error("OPENROUTER_API_KEY is required");
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

  jsonLog("info", "Invoking Codex Agent SDK for homelab audit", {
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
      phase: "codex-agent-sdk",
      elapsedMs: Date.now() - startMs,
      eventCount,
    });
  }, HEARTBEAT_INTERVAL_MS);

  let result;
  try {
    result = await runCodexAgentSdk({
      service: "temporal",
      callSite: "homelab-audit",
      prompt,
      model,
      cwd: process.cwd(),
      env: envForTrustedAgent({
        OPENROUTER_API_KEY: openRouterApiKey,
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
          phase: "codex-agent-sdk",
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
      error instanceof CodexAgentSdkRunError && error.generationStarted
        ? nonRetryableCodexFailure(error)
        : error;
    captureWithContext(classified, {
      model,
      durationMs: Date.now() - startMs,
      runtime: "codex_sdk",
      generationStarted:
        error instanceof CodexAgentSdkRunError
          ? error.generationStarted
          : undefined,
      possiblyAppliedEffects:
        error instanceof CodexAgentSdkRunError
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
      "Codex Agent SDK returned an empty homelab audit after a completed generation",
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
    runtime: "codex_sdk",
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
