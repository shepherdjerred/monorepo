import path from "node:path";
import { spawnManagedProcessGroup } from "../run-temporal-node.ts";
import { prepareMstestConfiguration } from "./mstest-configuration.ts";
import {
  applyDefaultEnvironment,
  cargoTestJUnit,
  completeJUnitReport,
  coverageArtifactFilename,
  dotnetCoverageArguments,
  removeExistingReport,
  sanitizeWorkspace,
  testStepReportName,
} from "./ci-reporting.ts";
import {
  WORKSPACE_TESTS_FILE,
  readWorkspaceTests,
  stepRunsInTier,
  workspaceDirectories,
  type TestStep,
  type TestTier,
  type WorkspaceTests,
} from "./test-manifest-schema.ts";
import {
  gradleJUnitReportPaths,
  writeGradleJUnitReport,
} from "./gradle-junit.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");

type SelectedStep = {
  readonly index?: number | undefined;
  readonly name: string;
  readonly step: TestStep;
};
type StepResult = {
  readonly exitCode: number;
  readonly reportingError?: Error | undefined;
};
type StepContext = {
  readonly step: TestStep;
  readonly name: string;
  readonly reportPath: string;
  readonly rawCoverageDirectory: string;
  readonly coverageEnabled: boolean;
  readonly environment: Record<string, string | undefined>;
};

function parseArguments(cliArgs: readonly string[]) {
  let requestedGroup: string | undefined;
  let requestedTier: TestTier | undefined;
  const unknown: string[] = [];
  for (let i = 0; i < cliArgs.length; i++) {
    const flag = cliArgs[i];
    const val = cliArgs[i + 1];
    if (
      flag === "--group" &&
      val !== undefined &&
      requestedGroup === undefined
    ) {
      requestedGroup = val;
      i++;
    } else if (
      flag === "--tier" &&
      requestedTier === undefined &&
      (val === "ci" || val === "extended")
    ) {
      requestedTier = val;
      i++;
    } else {
      unknown.push(flag ?? "");
    }
  }
  if (unknown.length > 0)
    throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
  return { requestedGroup, requestedTier: requestedTier ?? "ci" };
}

async function resolveMiseTool(
  miseBinary: string,
  tool: "node" | "dotnet",
  label: string,
  relativeBinary: readonly string[],
): Promise<string> {
  const result = Bun.spawnSync([miseBinary, "where", tool], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `mise where ${tool} exited with status ${String(result.exitCode)}; run mise install.`,
    );
  }
  const executable = path.join(
    new TextDecoder().decode(result.stdout).trim(),
    ...relativeBinary,
  );
  if (!(await Bun.file(executable).exists())) {
    throw new Error(
      `mise resolved a ${label} installation without ${executable}.`,
    );
  }
  return executable;
}

async function dotnetStepCommand(
  step: Extract<TestStep, { runner: "dotnet" }>,
  ctx: StepContext,
): Promise<string[]> {
  const [project, ...rest] = step.args;
  if (project === undefined)
    throw new Error("A .NET test project is required.");
  const wingetMise = path.join(
    Bun.env["LOCALAPPDATA"] ?? "",
    "Microsoft/WinGet/Links/mise.exe",
  );
  const mise =
    process.platform === "win32" && (await Bun.file(wingetMise).exists())
      ? wingetMise
      : "mise";
  const dotnetBin = await resolveMiseTool(mise, "dotnet", ".NET", [
    process.platform === "win32" ? "dotnet.exe" : "dotnet",
  ]);
  const covArgs = ctx.coverageEnabled
    ? dotnetCoverageArguments(step, ctx.rawCoverageDirectory, process.cwd())
    : [];
  const cfgPath =
    step.mstest === undefined
      ? undefined
      : await prepareMstestConfiguration({
          ...step.mstest,
          artifacts: ctx.rawCoverageDirectory,
          seedRaw: ctx.environment["TASKNOTES_TEST_SEED"],
        });
  const cfgArgs =
    cfgPath === undefined
      ? []
      : [
          "--config-file",
          cfgPath,
          ..."--report-trx --report-trx-filename results.trx --crashdump --hangdump".split(
            " ",
          ),
        ];
  return [
    dotnetBin,
    "test",
    path.resolve(process.cwd(), project),
    ...rest,
    ...cfgArgs,
    ...covArgs,
    ..."--report-junit --report-junit-filename".split(" "),
    ctx.reportPath,
  ];
}

async function commandForStep(ctx: StepContext): Promise<string[]> {
  const { step, reportPath, rawCoverageDirectory, coverageEnabled } = ctx;
  switch (step.runner) {
    case "vitest": {
      const nodeBin =
        step.runtime === "node"
          ? await resolveMiseTool("mise", "node", "Node", [
              "bin",
              process.platform === "win32" ? "node.exe" : "node",
            ])
          : undefined;
      const runtimeArgs = step.runtimeArgs ?? [];
      const prefix =
        nodeBin === undefined
          ? ["bun", ...runtimeArgs, "--no-install", "--bun", "vitest"]
          : [
              nodeBin,
              ...runtimeArgs,
              path.join(process.cwd(), "node_modules/vitest/vitest.mjs"),
            ];
      const covArgs = coverageEnabled
        ? [
            ..."--coverage --coverage.provider=istanbul --coverage.reporter=lcovonly".split(
              " ",
            ),
            `--coverage.reportsDirectory=${rawCoverageDirectory}`,
          ]
        : [];
      return [
        ...prefix,
        "--config",
        path.join(repositoryRoot, "vitest.config.ts"),
        "run",
        ...(step.args ?? []),
        ..."--reporter=default --reporter=junit".split(" "),
        `--outputFile=${reportPath}`,
        ...covArgs,
      ];
    }
    case "go":
      return [
        ..."go tool gotestsum --format standard-verbose --junitfile".split(" "),
        reportPath,
        "--",
        ...step.args,
        ...(coverageEnabled
          ? [`-coverprofile=${path.join(rawCoverageDirectory, "coverage.out")}`]
          : []),
      ];
    case "cargo":
      return [
        ..."mise exec -- cargo test".split(" "),
        ...step.args,
        ..."-- --format pretty".split(" "),
      ];
    case "dotnet":
      return dotnetStepCommand(step, ctx);
    case "gradle":
      if (coverageEnabled) {
        throw new Error(
          "Gradle steps do not collect coverage; remove coverageAlways from this workspace's ci-tests.json.",
        );
      }
      return ["mise", "exec", "--", "gradle", ...step.args, "--continue"];
    case "command":
      return step.command;
  }
}

function formatPrerequisiteAbort(
  packageName: string,
  tier: TestTier,
  failure: { readonly name: string; readonly exitCode: number },
  remainingSteps: readonly SelectedStep[],
): string {
  const skipped = remainingSteps.map((candidate) => candidate.name);
  const suffix = skipped.length === 0 ? "" : `: ${skipped.join(", ")}`;
  return `[run-ci-test] ${packageName} (${tier}): prerequisite step ${failure.name} exited ${String(failure.exitCode)}; skipped ${String(skipped.length)} step(s)${suffix}`;
}

export async function runSelectedTestSteps(options: {
  readonly packageName: string;
  readonly tier: TestTier;
  readonly steps: readonly SelectedStep[];
  readonly executeStep: (entry: SelectedStep) => Promise<StepResult>;
  readonly logError?:
    ((message: string, ...args: unknown[]) => void) | undefined;
}): Promise<number> {
  const logError = options.logError ?? console.error;
  const failedSteps: { readonly name: string; readonly exitCode: number }[] =
    [];
  let firstExitCode: number | undefined;

  for (const [position, entry] of options.steps.entries()) {
    const { exitCode, reportingError } = await options.executeStep(entry);
    if (exitCode === 0) {
      if (reportingError !== undefined) throw reportingError;
      continue;
    }
    if (reportingError !== undefined) {
      logError(
        "%s test process exited with status %d, and its JUnit report could not be finalized:",
        options.packageName,
        exitCode,
        reportingError,
      );
    }
    if (entry.step.runner === "command") {
      logError(
        formatPrerequisiteAbort(
          options.packageName,
          options.tier,
          { name: entry.name, exitCode },
          options.steps.slice(position + 1),
        ),
      );
      return exitCode;
    }
    failedSteps.push({ name: entry.name, exitCode });
    firstExitCode ??= exitCode;
  }

  if (firstExitCode !== undefined) {
    const details = failedSteps
      .map((failure) => `${failure.name}: exit ${String(failure.exitCode)}`)
      .join(", ");
    logError(
      `[run-ci-test] ${options.packageName} (${options.tier}): ${String(failedSteps.length)}/${String(options.steps.length)} step(s) failed (${details})`,
    );
    return firstExitCode;
  }
  return 0;
}

async function withCapturedReportingError(
  exitCode: number,
  writeReport: () => Promise<void>,
): Promise<StepResult> {
  try {
    await writeReport();
    return { exitCode };
  } catch (error) {
    return {
      exitCode,
      reportingError: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function spawnStepProcess(
  ctx: StepContext,
  command: readonly string[],
  startedAt: number,
  nestedDirs: readonly string[],
): Promise<StepResult> {
  const stepEnv =
    ctx.step.runner === "dotnet"
      ? {
          ...ctx.environment,
          DOTNET_MULTILEVEL_LOOKUP: "0",
          DOTNET_ROOT: path.dirname(command[0] ?? ""),
          ...(process.platform === "linux"
            ? { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" }
            : {}),
        }
      : ctx.environment;
  if (ctx.step.runner === "cargo") {
    const child = Bun.spawn([...command], {
      cwd: process.cwd(),
      env: stepEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await Promise.all([
      Bun.write(Bun.stdout, stdout),
      Bun.write(Bun.stderr, stderr),
    ]);
    return withCapturedReportingError(exitCode, async () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      await Bun.write(
        ctx.reportPath,
        cargoTestJUnit({ stdout, stderr }, ctx.name, elapsed, exitCode),
      );
    });
  }
  const exitCode = await spawnManagedProcessGroup(command, {
    cwd: process.cwd(),
    env: stepEnv,
  });
  if (ctx.step.runner !== "gradle") return { exitCode };
  return withCapturedReportingError(exitCode, () =>
    writeGradleJUnitReport({
      workspaceDirectory: process.cwd(),
      nestedWorkspaceDirectories: nestedDirs,
      reportPath: ctx.reportPath,
      exitCode,
    }),
  );
}

function selectWorkspaceSteps(
  ws: WorkspaceTests,
  group: string | undefined,
  tier: TestTier,
): SelectedStep[] {
  const groups = new Set(
    ws.steps.flatMap((s) => (s.group === undefined ? [] : [s.group])),
  );
  if (group === undefined && groups.size > 0) {
    throw new Error(
      `${ws.package} splits its CI tests into groups; pass --group with one of: ${[...groups].join(", ")}`,
    );
  }
  if (group !== undefined && !groups.has(group)) {
    throw new Error(`${ws.package} has no CI test group ${group}`);
  }
  const selected = ws.steps.flatMap((step, index) =>
    step.group === group && stepRunsInTier(step, tier)
      ? [{ name: testStepReportName(step, index), step }]
      : [],
  );
  if (!selected.some(({ step }) => (step.tier ?? "ci") === tier)) {
    const scope = group === undefined ? "" : ` in group ${group}`;
    throw new Error(
      `${ws.package} has no ${tier} steps${scope}; remove the test:${tier} script`,
    );
  }
  return selected;
}

async function prepareAndRunStep(
  workspace: WorkspaceTests,
  ctx: StepContext,
  nestedDirs: readonly string[],
): Promise<StepResult> {
  const artifact = coverageArtifactFilename(ctx.step);
  const coveragePath =
    artifact === undefined
      ? undefined
      : path.join(ctx.rawCoverageDirectory, artifact);
  await removeExistingReport(ctx.reportPath);
  if (ctx.step.runner === "gradle") {
    for (const stale of await gradleJUnitReportPaths(
      process.cwd(),
      nestedDirs,
    )) {
      await removeExistingReport(stale);
    }
  }
  if (coveragePath !== undefined && ctx.coverageEnabled) {
    await Bun.$`mkdir -p ${ctx.rawCoverageDirectory}`;
    await removeExistingReport(coveragePath);
  }
  const startedAt = performance.now();
  const command = await commandForStep(ctx);
  const spawned = await spawnStepProcess(ctx, command, startedAt, nestedDirs);
  const completed =
    spawned.reportingError === undefined
      ? await completeJUnitReport({
          runner: ctx.step.runner,
          reportPath: ctx.reportPath,
          workspace: workspace.package,
          name: ctx.name,
          durationSeconds: (performance.now() - startedAt) / 1000,
          exitCode: spawned.exitCode,
        })
      : undefined;
  const reportingError = spawned.reportingError ?? completed?.reportingError;
  if (
    reportingError === undefined &&
    coveragePath !== undefined &&
    ctx.coverageEnabled &&
    spawned.exitCode === 0
  ) {
    const file = Bun.file(coveragePath);
    if (!(await file.exists()) || file.size === 0) {
      throw new Error(
        `${workspace.package} step ${ctx.name} emitted no coverage report at ${coveragePath}`,
      );
    }
  }
  return { exitCode: spawned.exitCode, reportingError };
}

async function main(): Promise<void> {
  const { requestedGroup: group, requestedTier: tier } = parseArguments(
    process.argv.slice(2),
  );
  const workspaceDir = path
    .relative(repositoryRoot, process.cwd())
    .replaceAll(path.sep, "/");
  const workspace = await readWorkspaceTests(repositoryRoot, workspaceDir);
  if (workspace === undefined) {
    throw new Error(
      `No ${WORKSPACE_TESTS_FILE} declares CI tests for workspace ${workspaceDir}`,
    );
  }
  const selectedSteps = selectWorkspaceSteps(workspace, group, tier);
  const allWorkspaces = await workspaceDirectories(repositoryRoot);
  const nestedDirs = allWorkspaces
    .filter((dir) => dir.startsWith(`${workspaceDir}/`))
    .map((dir) => dir.slice(workspaceDir.length + 1));
  const sanitized = sanitizeWorkspace(workspace.package);
  const reportsDir = path.join(repositoryRoot, ".ci-reports");
  const junitDir = path.join(reportsDir, "junit", sanitized);
  const covRoot = path.join(reportsDir, "coverage/raw", sanitized);
  await Bun.$`mkdir -p ${junitDir}`;

  const environment: Record<string, string | undefined> = {
    ...Bun.env,
    CI_TEST_TIER: tier,
    ...(group === undefined ? {} : { CI_TEST_GROUP: group }),
  };
  applyDefaultEnvironment(environment, workspace.defaultEnv ?? {});
  const coverageEnabled = workspace.coverageAlways === true;

  const exitCode = await runSelectedTestSteps({
    packageName: workspace.package,
    tier,
    steps: selectedSteps,
    executeStep: ({ name, step }) =>
      prepareAndRunStep(
        workspace,
        {
          step,
          name,
          reportPath: path.resolve(junitDir, `${name}.xml`),
          rawCoverageDirectory: path.join(covRoot, name),
          coverageEnabled,
          environment,
        },
        nestedDirs,
      ),
  });
  if (exitCode !== 0) process.exit(exitCode);
}

if (import.meta.main) await main();
