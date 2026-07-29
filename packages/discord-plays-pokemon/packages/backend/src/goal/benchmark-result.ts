import path from "node:path";
import {
  deserializeSnapshot,
  type BenchmarkRunOutcome,
  type BenchmarkRunSummaryEntry,
  type BenchmarkWorkerResult,
  type CodexBenchmarkTelemetry,
} from "./benchmark-harness.ts";
import {
  evaluateCatchBenchmark,
  type CatchStateEvidence,
  type CatchBenchmarkResult,
  type GoalBenchmarkTelemetry,
} from "./benchmark-evaluator.ts";
import {
  BENCHMARK_PROVIDER_FAILURE_FILE,
  BENCHMARK_PROVIDER_STARTUP_FAILURE_FILE,
  BenchmarkProviderStartupFailureSchema,
  type BenchmarkProviderFailure,
  type BenchmarkProviderStartupFailure,
} from "./benchmark-provider-failure.ts";
import { computeCost } from "./pricing.ts";

export function telemetryForArtifact(input: {
  raw: CodexBenchmarkTelemetry;
  durationMs: number;
  model: string;
  reasoning: string;
  goalId: string;
  finalSaveSha256: string;
  wasmSha256: string;
  targetCommit: string;
  runnerCommit: string;
}): GoalBenchmarkTelemetry {
  return {
    durationMs: input.durationMs,
    turns: input.raw.turns,
    toolCalls: input.raw.toolCalls,
    toolErrors: input.raw.toolErrors,
    movementActions: input.raw.movementActions,
    movementStops: input.raw.movementStops,
    repeatedPositionLoops: input.raw.repeatedPositionLoops,
    ignoredInputs: input.raw.ignoredInputs,
    screenshots: input.raw.screenshots,
    knowledgeQueries: input.raw.knowledgeQueries,
    errors: input.raw.errors,
    inputTokens: input.raw.inputTokens,
    cachedInputTokens: input.raw.cachedInputTokens,
    outputTokens: input.raw.outputTokens,
    reasoningOutputTokens: input.raw.reasoningOutputTokens,
    estimatedCostUsd: computeCost(input.model, input.raw),
    traceId: input.goalId,
    saveSha256: input.finalSaveSha256,
    wasmSha256: input.wasmSha256,
    targetCommit: input.targetCommit,
    runnerCommit: input.runnerCommit,
    model: input.model,
    reasoningEffort: input.reasoning,
  };
}

export async function readProviderStartupFailure(
  runDirectory: string,
): Promise<BenchmarkProviderStartupFailure | null> {
  const file = Bun.file(
    path.join(runDirectory, BENCHMARK_PROVIDER_STARTUP_FAILURE_FILE),
  );
  if (!(await file.exists())) return null;
  return BenchmarkProviderStartupFailureSchema.parse(await file.json());
}

export function evaluateWorkerCatch(input: {
  workerResult: BenchmarkWorkerResult;
  providerFailure: BenchmarkProviderFailure | null;
  persistedSnapshot: CatchStateEvidence;
  codexExitCode: number | null;
}): CatchBenchmarkResult | null {
  if (
    input.codexExitCode !== null &&
    input.codexExitCode !== 0 &&
    input.providerFailure === null
  ) {
    throw new Error(
      `Codex exited with unclassified nonzero code ${String(input.codexExitCode)}`,
    );
  }
  if (input.providerFailure !== null) return null;
  return evaluateCatchBenchmark({
    startedAt: input.workerResult.goalState.startedAt,
    finishedAt: input.workerResult.goalState.finishedAt,
    initialSnapshot: deserializeSnapshot(input.workerResult.initialSnapshot),
    finalSnapshot: deserializeSnapshot(input.workerResult.finalSnapshot),
    catchEvents: input.workerResult.catchEvents,
    persistedSave: {
      persistedAt: input.workerResult.persistedSave.persistedAt,
      byteLength: input.workerResult.persistedSave.byteLength,
      snapshot: input.persistedSnapshot,
    },
  });
}

export function validRunOutcome(
  providerFailure: BenchmarkProviderFailure | null,
  evaluation: CatchBenchmarkResult | null,
): BenchmarkRunOutcome {
  if (providerFailure !== null) return "invalid-provider";
  return evaluation?.success === true ? "success" : "game-failure";
}

export function harnessRunOutcome(
  providerFailure: BenchmarkProviderFailure | null,
): BenchmarkRunOutcome {
  return providerFailure === null ? "harness-error" : "invalid-provider";
}

export function harnessErrorLifecycle(input: {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  codexExitCode: number | null;
  workerExitCode: number | null;
}) {
  return {
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    goalStatus: null,
    codexExitCode: input.codexExitCode,
    workerExitCode: input.workerExitCode,
  };
}

export function resultStatus(
  outcome: BenchmarkRunOutcome,
): "success" | "failed" | "invalid-measurement" | "harness-error" {
  switch (outcome) {
    case "success":
      return "success";
    case "game-failure":
      return "failed";
    case "invalid-provider":
      return "invalid-measurement";
    case "harness-error":
      return "harness-error";
  }
}

export function artifactPaths(input: {
  runName: string;
  hasFinalSave: boolean;
  hasJsonl: boolean;
  hasProviderFailure: boolean;
  hasProviderStartupFailure: boolean;
}): Record<string, string | null> {
  return {
    inputSave: `${input.runName}/input.flash`,
    finalSave: input.hasFinalSave ? `${input.runName}/persisted.flash` : null,
    codexJsonl: input.hasJsonl ? `${input.runName}/codex.jsonl` : null,
    screenshots: `${input.runName}/screenshots`,
    workerStdout: `${input.runName}/worker.stdout.log`,
    workerStderr: `${input.runName}/worker.stderr.log`,
    providerFailure: input.hasProviderFailure
      ? `${input.runName}/${BENCHMARK_PROVIDER_FAILURE_FILE}`
      : null,
    providerStartupFailure: input.hasProviderStartupFailure
      ? `${input.runName}/${BENCHMARK_PROVIDER_STARTUP_FAILURE_FILE}`
      : null,
  };
}

export function summaryEntry(input: {
  run: number;
  outcome: BenchmarkRunOutcome;
  durationMs: number;
  telemetry: GoalBenchmarkTelemetry;
  providerFailure: BenchmarkProviderFailure | null;
}): BenchmarkRunSummaryEntry {
  return {
    run: input.run,
    success: input.outcome === "success",
    outcome: input.outcome,
    providerFailure: input.providerFailure,
    durationMs: input.durationMs,
    telemetry: {
      turns: input.telemetry.turns,
      toolCalls: input.telemetry.toolCalls,
      errors: input.telemetry.errors,
      inputTokens: input.telemetry.inputTokens,
      outputTokens: input.telemetry.outputTokens,
      reasoningOutputTokens: input.telemetry.reasoningOutputTokens,
      estimatedCostUsd: input.telemetry.estimatedCostUsd,
    },
  };
}
