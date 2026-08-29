import { ApplicationFailure, Context } from "@temporalio/activity";
import {
  scoutSeasonRefreshSubprocessExitTotal,
  scoutSeasonRefreshTokensTotal,
} from "#observability/metrics.ts";
import { buildSeasonRefreshPrompt } from "./scout-season-refresh-prompt.ts";
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

const HEARTBEAT_INTERVAL_MS = 10_000;

export type SeasonAgentRunInput = {
  workdir: string;
  model: string;
  maxTurns: number;
  seasonsFile: string;
  seasonsTestFile: string;
  changelogFile: string;
  noDriftSentinel: string;
  driftedSentinel: string;
};

export type SeasonAgentRunResult = {
  exitCode: number;
  durationMs: number;
  costUsd: number | undefined;
  numTurns: number | undefined;
  resultText: string;
};

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Outside an activity (local dev script): heartbeats are a no-op.
  }
}

export async function runSeasonAgent(
  input: SeasonAgentRunInput,
): Promise<SeasonAgentRunResult> {
  const openRouterApiKey = Bun.env["OPENROUTER_API_KEY"];
  if (openRouterApiKey === undefined || openRouterApiKey === "") {
    throw new Error("OPENROUTER_API_KEY is required");
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
  const startedAtMs = Date.now();
  let eventCount = 0;
  const heartbeat = setInterval(() => {
    safeHeartbeat({
      phase: "codex-agent-sdk",
      elapsedMs: Date.now() - startedAtMs,
      eventCount,
    });
  }, HEARTBEAT_INTERVAL_MS);

  let result;
  try {
    result = await runCodexAgentSdk({
      service: "temporal",
      callSite: "scout-season-refresh",
      prompt,
      model: input.model,
      maxTurns: input.maxTurns,
      cwd: input.workdir,
      env: envForTrustedAgent({ OPENROUTER_API_KEY: openRouterApiKey }),
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
      },
    });
  } catch (error: unknown) {
    scoutSeasonRefreshSubprocessExitTotal.inc({ exit_code: "sdk_failed" });
    if (error instanceof CodexAgentSdkRunError && error.generationStarted) {
      throw ApplicationFailure.create({
        message: error.message,
        cause: error,
        nonRetryable: true,
        type: error.possiblyAppliedEffects
          ? "ScoutSeasonRefreshPossiblyAppliedFailure"
          : "ScoutSeasonRefreshBilledGenerationFailure",
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  }

  scoutSeasonRefreshSubprocessExitTotal.inc({ exit_code: "sdk_success" });
  for (const [direction, count] of [
    ["input", result.usage.inputTokens],
    ["output", result.usage.outputTokens],
    ["cache_create", result.usage.cacheCreationInputTokens],
    ["cache_read", result.usage.cacheReadInputTokens],
  ] as const) {
    scoutSeasonRefreshTokensTotal.inc({ model: input.model, direction }, count);
  }
  return {
    exitCode: 0,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    resultText: result.resultText,
  };
}
