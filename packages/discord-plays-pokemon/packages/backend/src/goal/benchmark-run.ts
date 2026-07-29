import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import {
  BenchmarkWorkerResultSchema,
  summarizeCodexJsonl,
  type BenchmarkArgs,
  type BenchmarkRunSummaryEntry,
  type CodexBenchmarkTelemetry,
} from "./benchmark-harness.ts";
import {
  BENCHMARK_PROVIDER_FAILURE_FILE,
  classifyCodexProviderFailure,
} from "./benchmark-provider-failure.ts";
import { requireBenchmarkOutputOutsideImplementation } from "./benchmark-output-location.ts";
import {
  benchmarkRuntimeOverlayDirectory,
  prepareBenchmarkRuntimeOverlay,
} from "./benchmark-runtime-overlay.ts";
import {
  artifactPaths,
  evaluateWorkerCatch,
  harnessRunOutcome,
  readProviderStartupFailure,
  resultStatus,
  summaryEntry,
  telemetryForArtifact,
  validRunOutcome,
} from "./benchmark-result.ts";
import { decodePersistedCatchState } from "./benchmark-save-oracle.ts";
import { computeCost } from "./pricing.ts";

export type BenchmarkImplementation = {
  packageRoot: string;
  backendRoot: string;
};

export type BenchmarkProvenanceInput = {
  inputSaveSha256: string;
  wasmSha256: string;
  targetPinnedWasmCommit: string;
  targetCommit: string;
  runnerCommit: string;
  runnerWorkingTreeDirty: boolean;
  workerSourceSha256: string;
  evaluatorSourceSha256: string;
  saveOracleSourceSha256: string;
  codexVersion: string;
  bunVersion: string;
};

export async function sha256File(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(filePath).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

export async function commandOutput(
  command: readonly string[],
  cwd: string,
): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${String(exitCode)}): ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}

export async function requireCleanGitWorktree(
  cwd: string,
  label: string,
): Promise<void> {
  const status = await commandOutput(
    ["git", "status", "--porcelain=v1", "--untracked-files=all"],
    cwd,
  );
  if (status.length > 0) {
    throw new Error(`${label} must be clean:\n${status}`);
  }
}

export async function writeBenchmarkJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, `${JSON.stringify(value, undefined, 2)}\n`, {
    createPath: true,
  });
  await rename(tmpPath, filePath);
}

export async function reserveBenchmarkDirectory(
  directory: string,
  label: string,
): Promise<void> {
  try {
    await mkdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `refusing to reuse existing ${label} directory: ${directory}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function copyStream(
  stream: ReadableStream<Uint8Array>,
  filePath: string,
): Promise<void> {
  const sink = Bun.file(filePath).writer();
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      await sink.write(result.value);
      await sink.flush();
    }
  } finally {
    reader.releaseLock();
    await sink.end();
  }
}

function childEnvironment(packageRoot: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment["POKEMON_KNOWLEDGE_ROOT"] = path.join(packageRoot, "knowledge");
  return environment;
}

async function runWorker(
  implementation: BenchmarkImplementation,
  workerSource: string,
  configPath: string,
  runDirectory: string,
): Promise<number> {
  const source = await Bun.file(workerSource).text();
  const child = Bun.spawn(["bun", "run", "-", "--config", configPath], {
    cwd: implementation.backendRoot,
    env: childEnvironment(implementation.packageRoot),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.stdin.write(source);
  await child.stdin.end();
  const results = await Promise.all([
    copyStream(child.stdout, path.join(runDirectory, "worker.stdout.log")),
    copyStream(child.stderr, path.join(runDirectory, "worker.stderr.log")),
    child.exited,
  ]);
  return results[2];
}

async function readTelemetry(runDirectory: string): Promise<{
  raw: CodexBenchmarkTelemetry;
  jsonl: string;
  jsonlSha256: string | null;
}> {
  const jsonlPath = path.join(runDirectory, "codex.jsonl");
  const file = Bun.file(jsonlPath);
  if (!(await file.exists())) {
    return {
      raw: summarizeCodexJsonl(""),
      jsonl: "",
      jsonlSha256: null,
    };
  }
  const jsonl = await file.text();
  return {
    raw: summarizeCodexJsonl(jsonl),
    jsonl,
    jsonlSha256: await sha256File(jsonlPath),
  };
}

type RunBenchmarkOnceInput = {
  args: BenchmarkArgs;
  implementation: BenchmarkImplementation;
  workerSource: string;
  run: number;
  sourceSaveBytes: Uint8Array;
  provenance: BenchmarkProvenanceInput;
};

export async function runBenchmarkOnce(
  input: RunBenchmarkOnceInput,
): Promise<BenchmarkRunSummaryEntry> {
  const { args, implementation, run } = input;
  const runName = `run-${String(run).padStart(3, "0")}`;
  const runDirectory = path.join(args.output, runName);
  await requireBenchmarkOutputOutsideImplementation(
    implementation.packageRoot,
    args.output,
  );
  benchmarkRuntimeOverlayDirectory(implementation.packageRoot, runDirectory);
  await reserveBenchmarkDirectory(runDirectory, "benchmark run");
  const resultPath = path.join(runDirectory, "result.json");
  const inputSavePath = path.join(runDirectory, "input.flash");
  const runSavePath = path.join(runDirectory, "run.flash");
  const persistedSavePath = path.join(runDirectory, "persisted.flash");
  const verificationSavePath = path.join(runDirectory, "verification.flash");
  const runtimeDirectory = await prepareBenchmarkRuntimeOverlay(
    implementation.packageRoot,
    runDirectory,
  );
  await Bun.write(inputSavePath, input.sourceSaveBytes, { createPath: true });
  await Bun.write(runSavePath, input.sourceSaveBytes);
  const controlPort = args.controlPort + (run - 1) * args.portStride;
  const workerConfigPath = path.join(runDirectory, "worker-config.json");
  await writeBenchmarkJson(workerConfigPath, {
    schemaVersion: 1,
    runSavePath,
    persistedSavePath,
    verificationSavePath,
    wasmPath: args.wasm,
    runtimeDirectory,
    runDirectory,
    controlHost: args.controlHost,
    controlPort,
    goal: args.goal,
    model: args.model,
    reasoning: args.reasoning,
    runtimeMinutes: args.runtimeMinutes,
    bootTimeoutSeconds: args.bootTimeoutSeconds,
    codexBinary: args.codexBinary,
  });

  const harnessStartedAt = new Date().toISOString();
  const harnessStartMs = Date.now();
  let workerExitCode: number | null = null;
  try {
    workerExitCode = await runWorker(
      implementation,
      input.workerSource,
      workerConfigPath,
      runDirectory,
    );
    if (workerExitCode !== 0) {
      throw new Error(
        `benchmark worker exited with code ${String(workerExitCode)}; see worker stdout/stderr logs`,
      );
    }
    const workerResult = BenchmarkWorkerResultSchema.parse(
      await Bun.file(path.join(runDirectory, "worker-result.json")).json(),
    );
    const finishedAt = workerResult.goalState.finishedAt;
    const durationMs =
      Date.parse(finishedAt) - Date.parse(workerResult.goalState.startedAt);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error("worker returned invalid goal lifecycle timestamps");
    }
    const finalSaveSha256 = await sha256File(persistedSavePath);
    const persistedSnapshot = decodePersistedCatchState(
      await Bun.file(persistedSavePath).bytes(),
    );
    const telemetryInput = await readTelemetry(runDirectory);
    const providerFailure = classifyCodexProviderFailure({
      jsonl: telemetryInput.jsonl,
      codexExitCode: workerResult.goalState.exitCode ?? null,
    });
    if (providerFailure !== null) {
      await writeBenchmarkJson(
        path.join(runDirectory, BENCHMARK_PROVIDER_FAILURE_FILE),
        providerFailure,
      );
    }
    const evaluation = evaluateWorkerCatch({
      workerResult,
      providerFailure,
      persistedSnapshot,
    });
    const telemetry = telemetryForArtifact({
      raw: telemetryInput.raw,
      durationMs,
      model: args.model,
      reasoning: args.reasoning,
      goalId: workerResult.goalState.id,
      finalSaveSha256,
      wasmSha256: input.provenance.wasmSha256,
      targetCommit: input.provenance.targetCommit,
      runnerCommit: input.provenance.runnerCommit,
    });
    const outcome = validRunOutcome(providerFailure, evaluation);
    await writeBenchmarkJson(resultPath, {
      schemaVersion: 1,
      run,
      status: resultStatus(outcome),
      outcome,
      providerFailure,
      configuration: {
        goal: args.goal,
        model: args.model,
        reasoningEffort: args.reasoning,
        runtimeMinutes: args.runtimeMinutes,
        controlHost: args.controlHost,
        controlPort,
        implementationRoot: implementation.packageRoot,
      },
      provenance: {
        inputSaveSha256: input.provenance.inputSaveSha256,
        finalSaveSha256,
        wasmSha256: input.provenance.wasmSha256,
        targetPinnedWasmCommit: input.provenance.targetPinnedWasmCommit,
        wasmIdentity: {
          kind: "external-file-sha256",
          targetPinVerification: "not-verified",
        },
        targetCommit: input.provenance.targetCommit,
        runnerCommit: input.provenance.runnerCommit,
        runnerWorkingTreeDirty: input.provenance.runnerWorkingTreeDirty,
        workerSourceSha256: input.provenance.workerSourceSha256,
        evaluatorSourceSha256: input.provenance.evaluatorSourceSha256,
        saveOracleSourceSha256: input.provenance.saveOracleSourceSha256,
        codexVersion: input.provenance.codexVersion,
        bunVersion: input.provenance.bunVersion,
        codexThreadId: telemetryInput.raw.codexThreadId,
        traceIdentifier: workerResult.goalState.id,
        codexJsonlSha256: telemetryInput.jsonlSha256,
      },
      lifecycle: {
        startedAt: workerResult.goalState.startedAt,
        finishedAt,
        durationMs,
        goalStatus: workerResult.goalState.status,
        codexExitCode: workerResult.goalState.exitCode ?? null,
        workerExitCode,
      },
      evidence: {
        initialSnapshot: workerResult.initialSnapshot,
        finalSnapshot: workerResult.finalSnapshot,
        catchEvents: workerResult.catchEvents,
        persistedSave: workerResult.persistedSave,
        persistedSaveOracle: {
          implementation: "runner-gen3-flash-v1",
          party: persistedSnapshot.party,
          dexOwned: [...persistedSnapshot.dexOwned],
        },
      },
      evaluation,
      telemetry,
      artifacts: artifactPaths({
        runName,
        hasFinalSave: true,
        hasJsonl: true,
        hasProviderFailure: providerFailure !== null,
        hasProviderStartupFailure: false,
      }),
      error: null,
    });
    return summaryEntry({
      run,
      outcome,
      durationMs,
      telemetry,
      providerFailure,
    });
  } catch (error) {
    const telemetryInput = await readTelemetry(runDirectory);
    const startupFailure = await readProviderStartupFailure(runDirectory);
    const providerFailure = classifyCodexProviderFailure({
      jsonl: telemetryInput.jsonl,
      codexExitCode: null,
      startupError: startupFailure?.message ?? null,
    });
    if (providerFailure !== null) {
      await writeBenchmarkJson(
        path.join(runDirectory, BENCHMARK_PROVIDER_FAILURE_FILE),
        providerFailure,
      );
    }
    const durationMs = Date.now() - harnessStartMs;
    const message = error instanceof Error ? error.message : String(error);
    const finalSave = Bun.file(persistedSavePath);
    const finalSaveSha256 = (await finalSave.exists())
      ? await sha256File(persistedSavePath)
      : null;
    const cost = computeCost(args.model, telemetryInput.raw);
    const outcome = harnessRunOutcome(providerFailure);
    await writeBenchmarkJson(resultPath, {
      schemaVersion: 1,
      run,
      status: resultStatus(outcome),
      outcome,
      providerFailure,
      configuration: {
        goal: args.goal,
        model: args.model,
        reasoningEffort: args.reasoning,
        runtimeMinutes: args.runtimeMinutes,
        controlHost: args.controlHost,
        controlPort,
        implementationRoot: implementation.packageRoot,
      },
      provenance: {
        inputSaveSha256: input.provenance.inputSaveSha256,
        finalSaveSha256,
        wasmSha256: input.provenance.wasmSha256,
        targetPinnedWasmCommit: input.provenance.targetPinnedWasmCommit,
        wasmIdentity: {
          kind: "external-file-sha256",
          targetPinVerification: "not-verified",
        },
        targetCommit: input.provenance.targetCommit,
        runnerCommit: input.provenance.runnerCommit,
        runnerWorkingTreeDirty: input.provenance.runnerWorkingTreeDirty,
        workerSourceSha256: input.provenance.workerSourceSha256,
        evaluatorSourceSha256: input.provenance.evaluatorSourceSha256,
        saveOracleSourceSha256: input.provenance.saveOracleSourceSha256,
        codexVersion: input.provenance.codexVersion,
        bunVersion: input.provenance.bunVersion,
        codexThreadId: telemetryInput.raw.codexThreadId,
        traceIdentifier: null,
        codexJsonlSha256: telemetryInput.jsonlSha256,
      },
      lifecycle: {
        startedAt: harnessStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        goalStatus: null,
        codexExitCode: null,
        workerExitCode,
      },
      evidence: null,
      evaluation: null,
      telemetry: {
        ...telemetryInput.raw,
        durationMs,
        estimatedCostUsd: cost,
      },
      artifacts: artifactPaths({
        runName,
        hasFinalSave: finalSaveSha256 !== null,
        hasJsonl: telemetryInput.jsonlSha256 !== null,
        hasProviderFailure: providerFailure !== null,
        hasProviderStartupFailure: startupFailure !== null,
      }),
      error: message,
    });
    return {
      run,
      success: false,
      outcome,
      providerFailure,
      durationMs,
      telemetry: {
        turns: telemetryInput.raw.turns,
        toolCalls: telemetryInput.raw.toolCalls,
        errors: telemetryInput.raw.errors + 1,
        inputTokens: telemetryInput.raw.inputTokens,
        outputTokens: telemetryInput.raw.outputTokens,
        reasoningOutputTokens: telemetryInput.raw.reasoningOutputTokens,
        estimatedCostUsd: cost,
      },
    };
  }
}
