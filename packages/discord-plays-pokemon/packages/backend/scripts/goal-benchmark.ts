#!/usr/bin/env bun

import path from "node:path";
import { z } from "zod";
import {
  buildBenchmarkSummary,
  parseBenchmarkArgs,
} from "#src/goal/benchmark-harness.ts";
import { requireBenchmarkOutputOutsideImplementation } from "#src/goal/benchmark-output-location.ts";
import { validateCatchBenchmarkSourceSave } from "#src/goal/benchmark-source-save.ts";
import { runBenchmarkSeries } from "#src/goal/benchmark-series.ts";
import {
  commandOutput,
  requireCleanGitWorktree,
  reserveBenchmarkDirectory,
  runBenchmarkOnce,
  sha256File,
  writeBenchmarkJson,
  type BenchmarkImplementation,
} from "#src/goal/benchmark-run.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../../..");
const WORKER_SOURCE = path.join(import.meta.dir, "goal-benchmark-worker.ts");
const EVALUATOR_SOURCE = path.resolve(
  import.meta.dir,
  "../src/goal/benchmark-evaluator.ts",
);
const SAVE_ORACLE_SOURCE = path.resolve(
  import.meta.dir,
  "../src/goal/benchmark-save-oracle.ts",
);

const UpstreamSchema = z.looseObject({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
});

function usage(): string {
  return `Run a real-model Pokemon catch benchmark and preserve all evidence.

Usage:
  bun run benchmark:goal --save <128KiB.sav> --wasm <pokeemerald.wasm> --output <directory> [options]

Required:
  --save <path>                 Source 128 KiB Emerald flash save
  --wasm <path>                 Built pokeemerald WASM
  --output <directory>          New artifact directory; existing results are never overwritten

Options:
  --runs <n>                    Sequential fresh-save runs (default: 1)
  --goal <text>                 Objective (default: "get me a pokeman")
  --model <id>                  Codex model (default: gpt-5.6-luna)
  --reasoning <effort>          low|medium|high|xhigh (default: medium)
  --runtime <minutes>           Per-run model deadline, 1-30 (default: 30)
  --control-host <host>         Control server host (default: 127.0.0.1)
  --control-port <port>         First run's port (default: 18082)
  --port-stride <n>             Added to the port for each run (default: 1)
  --codex-binary <path>         Codex executable (default: codex)
  --implementation-root <path>  Repo or discord-plays-pokemon package root
                                (default: this script's package root)
  --boot-timeout-seconds <n>    Boot/Continue deadline (default: 60)
  -h, --help                    Show this help

The harness provides only mechanical boot/Continue handling. The model chooses
all gameplay actions. Each run writes result.json, raw Codex JSONL, logs,
screenshots, and independent save evidence. summary.json is written last.
The selected implementation must have a clean Git worktree. The supplied WASM
is identified by its SHA-256; the target's configured upstream pin is recorded
separately with an explicit not-verified relationship to that external file.

Exit status:
  0  Every requested run passed the strict catch evaluator
  1  One or more valid runs failed the strict catch evaluator
  2  Invalid measurement, harness error, invalid arguments, or preflight failure`;
}

async function requireFile(filePath: string, label: string): Promise<void> {
  if (!(await Bun.file(filePath).exists())) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function resolveImplementationRoot(
  requestedRoot: string,
): Promise<BenchmarkImplementation> {
  const packageCandidate = path.resolve(requestedRoot);
  const repositoryCandidate = path.join(
    packageCandidate,
    "packages",
    "discord-plays-pokemon",
  );
  const packageRoot = (await Bun.file(
    path.join(packageCandidate, "packages/backend/package.json"),
  ).exists())
    ? packageCandidate
    : repositoryCandidate;
  const backendRoot = path.join(packageRoot, "packages/backend");
  const required = [
    "package.json",
    "src/emulator/emulator.ts",
    "src/game/events/watcher.ts",
    "src/goal/goal-manager.ts",
    "src/goal/control-server.ts",
    "src/goal/pokemonctl.ts",
    "node_modules/zod/package.json",
  ];
  for (const relativePath of required) {
    await requireFile(
      path.join(backendRoot, relativePath),
      "implementation file",
    );
  }
  await requireFile(
    path.join(packageRoot, "wasm-src/upstream.json"),
    "implementation upstream manifest",
  );
  return { packageRoot, backendRoot };
}

async function main(): Promise<void> {
  const cliArgs = Bun.argv.slice(2);
  if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const args = parseBenchmarkArgs(cliArgs, PACKAGE_ROOT, process.cwd());
  await requireFile(args.save, "source save");
  await requireFile(args.wasm, "WASM");
  await requireFile(WORKER_SOURCE, "benchmark worker source");
  await requireFile(EVALUATOR_SOURCE, "benchmark evaluator source");
  await requireFile(SAVE_ORACLE_SOURCE, "benchmark save oracle source");
  const sourceSaveBytes = await Bun.file(args.save).bytes();
  validateCatchBenchmarkSourceSave(sourceSaveBytes);
  const implementation = await resolveImplementationRoot(
    args.implementationRoot,
  );
  await requireBenchmarkOutputOutsideImplementation(
    implementation.packageRoot,
    args.output,
  );
  await requireCleanGitWorktree(
    implementation.packageRoot,
    "target implementation",
  );
  await requireCleanGitWorktree(PACKAGE_ROOT, "benchmark runner");
  const [
    sourceSaveSha256,
    wasmSha256,
    targetCommit,
    runnerCommit,
    workerSourceSha256,
    evaluatorSourceSha256,
    saveOracleSourceSha256,
    codexVersion,
    bunVersion,
  ] = await Promise.all([
    sha256File(args.save),
    sha256File(args.wasm),
    commandOutput(["git", "rev-parse", "HEAD"], implementation.packageRoot),
    commandOutput(["git", "rev-parse", "HEAD"], PACKAGE_ROOT),
    sha256File(WORKER_SOURCE),
    sha256File(EVALUATOR_SOURCE),
    sha256File(SAVE_ORACLE_SOURCE),
    commandOutput([args.codexBinary, "--version"], implementation.backendRoot),
    commandOutput(["bun", "--version"], implementation.backendRoot),
  ]);
  const upstream = UpstreamSchema.parse(
    await Bun.file(
      path.join(implementation.packageRoot, "wasm-src/upstream.json"),
    ).json(),
  );
  await reserveBenchmarkDirectory(args.output, "benchmark output");
  const summaryPath = path.join(args.output, "summary.json");
  const entries = await runBenchmarkSeries(args.runs, async (run) => {
    console.error(
      `benchmark run ${String(run)}/${String(args.runs)} on port ${String(
        args.controlPort + (run - 1) * args.portStride,
      )}`,
    );
    return await runBenchmarkOnce({
      args,
      implementation,
      workerSource: WORKER_SOURCE,
      run,
      sourceSaveBytes,
      provenance: {
        inputSaveSha256: sourceSaveSha256,
        wasmSha256,
        targetPinnedWasmCommit: upstream.commit,
        targetCommit,
        runnerCommit,
        runnerWorkingTreeDirty: false,
        workerSourceSha256,
        evaluatorSourceSha256,
        saveOracleSourceSha256,
        codexVersion,
        bunVersion,
      },
    });
  });
  const summary = {
    ...buildBenchmarkSummary(args.runs, entries),
    configuration: {
      goal: args.goal,
      model: args.model,
      reasoningEffort: args.reasoning,
      runtimeMinutes: args.runtimeMinutes,
      implementationRoot: implementation.packageRoot,
    },
    provenance: {
      inputSaveSha256: sourceSaveSha256,
      wasmSha256,
      targetPinnedWasmCommit: upstream.commit,
      wasmIdentity: {
        kind: "external-file-sha256",
        targetPinVerification: "not-verified",
      },
      targetCommit,
      runnerCommit,
      runnerWorkingTreeDirty: false,
      workerSourceSha256,
      evaluatorSourceSha256,
      saveOracleSourceSha256,
      codexVersion,
      bunVersion,
    },
  };
  await writeBenchmarkJson(summaryPath, summary);
  process.stdout.write(`${summaryPath}\n`);
  if (summary.invalidRuns > 0) {
    process.exitCode = 2;
  } else if (!summary.allSucceeded) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
