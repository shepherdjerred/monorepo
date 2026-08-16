import { ApplicationFailure, Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import {
  scoutSeasonRefreshSubprocessExitTotal,
  scoutSeasonRefreshTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { emitOtel } from "#observability/log.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
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
import { buildSeasonRefreshPrompt } from "./scout-season-refresh-prompt.ts";

const COMPONENT = "scout-season-refresh";
const HEARTBEAT_INTERVAL_MS = 10_000;

const ALLOWED_TOOLS = [
  "WebFetch",
  "WebSearch",
  "Read",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
] as const;

export type ClaudeRunInput = {
  workdir: string;
  model: string;
  maxTurns: number;
  seasonsFile: string;
  seasonsTestFile: string;
  changelogFile: string;
  noDriftSentinel: string;
  driftedSentinel: string;
};

export type ClaudeRunResult = {
  exitCode: number;
  durationMs: number;
  costUsd: number | undefined;
  numTurns: number | undefined;
  resultText: string;
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
  if (info !== undefined) Object.assign(base, info);
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
    scope.setContext("scoutSeasonRefresh", { ...info, ...extra });
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

function recordTokenUsage(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  },
): void {
  scoutSeasonRefreshTokensTotal.inc(
    { model, direction: "input" },
    usage.inputTokens,
  );
  scoutSeasonRefreshTokensTotal.inc(
    { model, direction: "output" },
    usage.outputTokens,
  );
  scoutSeasonRefreshTokensTotal.inc(
    { model, direction: "cache_create" },
    usage.cacheCreationInputTokens,
  );
  scoutSeasonRefreshTokensTotal.inc(
    { model, direction: "cache_read" },
    usage.cacheReadInputTokens,
  );
}

export async function runClaude(
  input: ClaudeRunInput,
): Promise<ClaudeRunResult> {
  const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (claudeToken === undefined || claudeToken === "") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required");
  }

  const prompt = buildSeasonRefreshPrompt({
    today: new Date().toISOString().slice(0, 10),
    workdir: input.workdir,
    seasonsFile: input.seasonsFile,
    seasonsTestFile: input.seasonsTestFile,
    changelogFile: input.changelogFile,
    noDriftSentinel: input.noDriftSentinel,
    driftedSentinel: input.driftedSentinel,
  });
  jsonLog("info", "Invoking Claude Agent SDK for scout-season-refresh", {
    workdir: input.workdir,
    model: input.model,
    maxTurns: input.maxTurns,
  });

  const secretState = await createAgentTaskSecretTokenState(undefined);
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
                "Season refresh stopped before Temporal start-to-close timeout",
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
      callSite: "scout-season-refresh",
      prompt,
      model: input.model,
      maxTurns: input.maxTurns,
      cwd: input.workdir,
      allowedTools: ALLOWED_TOOLS,
      env: envForTrustedAgent({ CLAUDE_CODE_OAUTH_TOKEN: claudeToken }),
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
        jsonLog("info", "season refresh agent event", {
          eventType: event.type,
          elapsedMs: event.elapsedMs,
        });
      },
    });
  } catch (error: unknown) {
    scoutSeasonRefreshSubprocessExitTotal.inc({ exit_code: "sdk_failed" });
    const classified =
      error instanceof ClaudeAgentSdkRunError && error.generationStarted
        ? ApplicationFailure.create({
            message: error.message,
            cause: error,
            nonRetryable: true,
            type: error.possiblyAppliedEffects
              ? "ScoutSeasonRefreshPossiblyAppliedFailure"
              : "ScoutSeasonRefreshBilledGenerationFailure",
          })
        : error;
    captureWithContext(classified, {
      runtime: "claude_agent_sdk",
      durationMs: Date.now() - startMs,
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

  scoutSeasonRefreshSubprocessExitTotal.inc({ exit_code: "sdk_success" });
  recordTokenUsage(input.model, result.usage);
  jsonLog("info", "Scout season refresh agent completed", {
    runtime: "claude_agent_sdk",
    sessionId: result.sessionId,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    resultLength: result.resultText.length,
  });

  return {
    exitCode: 0,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    resultText: result.resultText,
  };
}
