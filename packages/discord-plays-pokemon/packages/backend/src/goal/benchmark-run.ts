import path from "node:path";
import { rename } from "node:fs/promises";
import {
  BenchmarkWorkerResultSchema,
  deserializeSnapshot,
  summarizeCodexJsonl,
  type BenchmarkArgs,
  type BenchmarkRunSummaryEntry,
  type CodexBenchmarkTelemetry,
} from "./benchmark-harness.ts";
import {
  evaluateCatchBenchmark,
  type GoalBenchmarkTelemetry,
} from "./benchmark-evaluator.ts";
import { computeCost } from "./pricing.ts";

export type BenchmarkImplementation = {
  packageRoot: string;
  backendRoot: string;
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

function telemetryForArtifact(input: {
  raw: CodexBenchmarkTelemetry;
  durationMs: number;
  model: string;
  reasoning: string;
  goalId: string;
  finalSaveSha256: string;
  wasmCommit: string;
  gitCommit: string;
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
    wasmCommit: input.wasmCommit,
    gitCommit: input.gitCommit,
    model: input.model,
    reasoningEffort: input.reasoning,
  };
}

async function readTelemetry(runDirectory: string): Promise<{
  raw: CodexBenchmarkTelemetry;
  jsonlSha256: string | null;
}> {
  const jsonlPath = path.join(runDirectory, "codex.jsonl");
  const file = Bun.file(jsonlPath);
  if (!(await file.exists())) {
    return { raw: summarizeCodexJsonl(""), jsonlSha256: null };
  }
  return {
    raw: summarizeCodexJsonl(await file.text()),
    jsonlSha256: await sha256File(jsonlPath),
  };
}

type RunBenchmarkOnceInput = {
  args: BenchmarkArgs;
  implementation: BenchmarkImplementation;
  workerSource: string;
  run: number;
  sourceSaveBytes: Uint8Array;
  sourceSaveSha256: string;
  wasmSha256: string;
  wasmCommit: string;
  gitCommit: string;
};

export async function runBenchmarkOnce(
  input: RunBenchmarkOnceInput,
): Promise<BenchmarkRunSummaryEntry> {
  const { args, implementation, run } = input;
  const runName = `run-${String(run).padStart(3, "0")}`;
  const runDirectory = path.join(args.output, runName);
  const resultPath = path.join(runDirectory, "result.json");
  if (await Bun.file(resultPath).exists()) {
    throw new Error(
      `refusing to overwrite existing run artifact: ${resultPath}`,
    );
  }
  const inputSavePath = path.join(runDirectory, "input.flash");
  const runSavePath = path.join(runDirectory, "run.flash");
  const persistedSavePath = path.join(runDirectory, "persisted.flash");
  const verificationSavePath = path.join(runDirectory, "verification.flash");
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
    runtimeDirectory: implementation.packageRoot,
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
    const evaluation = evaluateCatchBenchmark({
      startedAt: workerResult.goalState.startedAt,
      finishedAt,
      initialSnapshot: deserializeSnapshot(workerResult.initialSnapshot),
      finalSnapshot: deserializeSnapshot(workerResult.finalSnapshot),
      catchEvents: workerResult.catchEvents,
      persistedSave: {
        persistedAt: workerResult.persistedSave.persistedAt,
        byteLength: workerResult.persistedSave.byteLength,
        snapshot: deserializeSnapshot(workerResult.persistedSave.snapshot),
      },
    });
    const finalSaveSha256 = await sha256File(persistedSavePath);
    const telemetryInput = await readTelemetry(runDirectory);
    const telemetry = telemetryForArtifact({
      raw: telemetryInput.raw,
      durationMs,
      model: args.model,
      reasoning: args.reasoning,
      goalId: workerResult.goalState.id,
      finalSaveSha256,
      wasmCommit: input.wasmCommit,
      gitCommit: input.gitCommit,
    });
    await writeBenchmarkJson(resultPath, {
      schemaVersion: 1,
      run,
      status: evaluation.success ? "success" : "failed",
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
        inputSaveSha256: input.sourceSaveSha256,
        finalSaveSha256,
        wasmSha256: input.wasmSha256,
        wasmCommit: input.wasmCommit,
        gitCommit: input.gitCommit,
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
      },
      evaluation,
      telemetry,
      artifacts: artifactPaths(runName, true, true),
      error: null,
    });
    return summaryEntry(run, evaluation.success, durationMs, telemetry);
  } catch (error) {
    const telemetryInput = await readTelemetry(runDirectory);
    const durationMs = Date.now() - harnessStartMs;
    const message = error instanceof Error ? error.message : String(error);
    const finalSave = Bun.file(persistedSavePath);
    const finalSaveSha256 = (await finalSave.exists())
      ? await sha256File(persistedSavePath)
      : null;
    const cost = computeCost(args.model, telemetryInput.raw);
    await writeBenchmarkJson(resultPath, {
      schemaVersion: 1,
      run,
      status: "harness-error",
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
        inputSaveSha256: input.sourceSaveSha256,
        finalSaveSha256,
        wasmSha256: input.wasmSha256,
        wasmCommit: input.wasmCommit,
        gitCommit: input.gitCommit,
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
      artifacts: artifactPaths(
        runName,
        finalSaveSha256 !== null,
        telemetryInput.jsonlSha256 !== null,
      ),
      error: message,
    });
    return {
      run,
      success: false,
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

function artifactPaths(
  runName: string,
  hasFinalSave: boolean,
  hasJsonl: boolean,
): Record<string, string | null> {
  return {
    inputSave: `${runName}/input.flash`,
    finalSave: hasFinalSave ? `${runName}/persisted.flash` : null,
    codexJsonl: hasJsonl ? `${runName}/codex.jsonl` : null,
    screenshots: `${runName}/screenshots`,
    workerStdout: `${runName}/worker.stdout.log`,
    workerStderr: `${runName}/worker.stderr.log`,
  };
}

function summaryEntry(
  run: number,
  success: boolean,
  durationMs: number,
  telemetry: GoalBenchmarkTelemetry,
): BenchmarkRunSummaryEntry {
  return {
    run,
    success,
    durationMs,
    telemetry: {
      turns: telemetry.turns,
      toolCalls: telemetry.toolCalls,
      errors: telemetry.errors,
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      reasoningOutputTokens: telemetry.reasoningOutputTokens,
      estimatedCostUsd: telemetry.estimatedCostUsd,
    },
  };
}
