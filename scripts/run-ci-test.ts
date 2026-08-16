import path from "node:path";
import {
  applyDefaultEnvironment,
  cargoTestJUnit,
  completeJUnitReport,
  coverageArtifactFilename,
  dotnetCoverageArguments,
  removeExistingReport,
  sanitizeWorkspace,
  testStepReportName,
  TestManifestSchema,
  type TestStep,
} from "./ci-reporting.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const coverageEnabled = Bun.env["CI_TEST_COVERAGE"] === "1";
const bunLcovReporter = "--coverage-reporter=lcov";
if (process.argv.slice(2).length > 0) {
  throw new Error(`Unknown arguments: ${process.argv.slice(2).join(", ")}`);
}
const manifest = TestManifestSchema.parse(
  await Bun.file(path.join(import.meta.dir, "ci-test-manifest.json")).json(),
);
const workspaceDirectory = path
  .relative(repositoryRoot, process.cwd())
  .split(path.sep)
  .join("/");
const workspaceEntry = manifest.workspaces.find(
  (entry) => entry.directory === workspaceDirectory,
);

if (workspaceEntry === undefined) {
  throw new Error(
    `No CI test reporting entry exists for workspace ${workspaceDirectory}`,
  );
}
const workspace = workspaceEntry;

const outputDirectory = path.join(
  repositoryRoot,
  ".ci-reports",
  "junit",
  sanitizeWorkspace(workspace.package),
);
await Bun.$`mkdir -p ${outputDirectory}`;

const environment = { ...Bun.env };
applyDefaultEnvironment(environment, workspace.defaultEnv ?? {});
let cachedDotnetExecutable: string | undefined;

async function pinnedDotnetExecutable(): Promise<string> {
  if (cachedDotnetExecutable !== undefined) {
    return cachedDotnetExecutable;
  }
  const wingetMise = path.join(
    Bun.env["LOCALAPPDATA"] ?? "",
    "Microsoft",
    "WinGet",
    "Links",
    "mise.exe",
  );
  const mise =
    process.platform === "win32" && (await Bun.file(wingetMise).exists())
      ? wingetMise
      : "mise";
  const result = Bun.spawnSync([mise, "where", "dotnet"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `mise where dotnet exited with status ${String(result.exitCode)}; run mise install.`,
    );
  }
  const dotnetRoot = new TextDecoder().decode(result.stdout).trim();
  const executable = path.join(
    dotnetRoot,
    process.platform === "win32" ? "dotnet.exe" : "dotnet",
  );
  if (!(await Bun.file(executable).exists())) {
    throw new Error(`mise resolved a .NET installation without ${executable}.`);
  }
  cachedDotnetExecutable = executable;
  return executable;
}

function coverageDirectory(step: TestStep, index: number): string {
  return path.join(
    repositoryRoot,
    ".ci-reports",
    "coverage",
    "raw",
    sanitizeWorkspace(workspace.package),
    testStepReportName(step, index),
  );
}

function vitestCoverageArguments(rawCoverageDirectory: string): string[] {
  return coverageEnabled
    ? [
        "--coverage",
        "--coverage.provider=istanbul",
        "--coverage.reporter=lcov",
        `--coverage.reportsDirectory=${rawCoverageDirectory}`,
      ]
    : [];
}

async function commandForStep(
  step: TestStep,
  reportPath: string,
  rawCoverageDirectory: string,
): Promise<string[]> {
  switch (step.runner) {
    case "bun":
      return [
        "bun",
        ...(step.bunArgs ?? []),
        "test",
        ...(coverageEnabled && step.coverageConfig !== undefined
          ? [`--config=${step.coverageConfig}`]
          : []),
        "--reporter=junit",
        `--reporter-outfile=${reportPath}`,
        ...(coverageEnabled
          ? [
              "--coverage",
              bunLcovReporter,
              `--coverage-dir=${rawCoverageDirectory}`,
            ]
          : []),
        ...(step.args ?? []),
      ];
    case "vitest":
      return [
        "bun",
        "x",
        "--no-install",
        "vitest",
        "run",
        ...step.args,
        "--reporter=default",
        "--reporter=junit",
        `--outputFile=${reportPath}`,
        ...vitestCoverageArguments(rawCoverageDirectory),
      ];
    case "go":
      return [
        "go",
        "tool",
        "gotestsum",
        "--format",
        "standard-verbose",
        "--junitfile",
        reportPath,
        "--",
        ...step.args,
        ...(coverageEnabled
          ? [`-coverprofile=${path.join(rawCoverageDirectory, "coverage.out")}`]
          : []),
      ];
    case "cargo":
      return ["cargo", "test", ...step.args, "--", "--format", "pretty"];
    case "dotnet": {
      const [project, ...argumentsList] = step.args;
      if (project === undefined) {
        throw new Error("A .NET test project is required.");
      }
      const coverageArguments = coverageEnabled
        ? dotnetCoverageArguments(step, rawCoverageDirectory, process.cwd())
        : [];
      return [
        await pinnedDotnetExecutable(),
        "test",
        path.resolve(process.cwd(), project),
        ...argumentsList,
        ...coverageArguments,
        "--report-junit",
        "--report-junit-filename",
        reportPath,
      ];
    }
    case "command":
      return step.command;
  }
}

function expectedCoveragePath(
  step: TestStep,
  rawCoverageDirectory: string,
): string | undefined {
  const artifactFilename = coverageArtifactFilename(step);
  return artifactFilename === undefined
    ? undefined
    : path.join(rawCoverageDirectory, artifactFilename);
}

function fallbackBunCoveragePath(step: TestStep): string | undefined {
  return coverageEnabled && step.runner === "bun"
    ? path.join(process.cwd(), "coverage", "lcov.info")
    : undefined;
}

for (const [index, step] of workspace.steps.entries()) {
  const name = testStepReportName(step, index);
  const reportPath = path.resolve(outputDirectory, `${name}.xml`);
  await removeExistingReport(reportPath);
  const rawCoverageDirectory = coverageDirectory(step, index);
  if (
    coverageEnabled &&
    expectedCoveragePath(step, rawCoverageDirectory) !== undefined
  ) {
    await Bun.$`mkdir -p ${rawCoverageDirectory}`;
  }
  const fallbackCoveragePath = fallbackBunCoveragePath(step);
  if (
    fallbackCoveragePath !== undefined &&
    (await Bun.file(fallbackCoveragePath).exists())
  ) {
    await Bun.file(fallbackCoveragePath).delete();
  }
  const startedAt = performance.now();
  const command = await commandForStep(step, reportPath, rawCoverageDirectory);
  const stepEnvironment =
    step.runner === "dotnet"
      ? {
          ...environment,
          DOTNET_MULTILEVEL_LOOKUP: "0",
          DOTNET_ROOT: path.dirname(command[0] ?? ""),
          // Matches packages/tasknotes-windows/scripts/dotnet.ts: the Linux CI
          // image has no libicu, while Windows resource generation requires
          // real locale data.
          ...(process.platform === "linux"
            ? { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" }
            : {}),
        }
      : environment;
  let exitCode: number;
  let reportingError: Error | undefined;
  if (step.runner === "cargo") {
    const child = Bun.spawn(command, {
      cwd: process.cwd(),
      env: stepEnvironment,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [cargoExitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await Promise.all([
      Bun.write(Bun.stdout, stdout),
      Bun.write(Bun.stderr, stderr),
    ]);
    exitCode = cargoExitCode;
    // Synthesizing and writing Cargo's report happens outside the
    // completeJUnitReport try/catch, so a write failure here (e.g. a full
    // report filesystem) must not crash the wrapper with its own status and
    // mask Cargo's exit code. Capture it as a reporting error like the
    // finalization path does.
    try {
      await Bun.write(
        reportPath,
        cargoTestJUnit(
          { stdout, stderr },
          name,
          (performance.now() - startedAt) / 1000,
          exitCode,
        ),
      );
    } catch (error) {
      reportingError =
        error instanceof Error ? error : new Error(String(error));
    }
  } else {
    const child = Bun.spawn(command, {
      cwd: process.cwd(),
      env: stepEnvironment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    exitCode = await child.exited;
  }
  const durationSeconds = (performance.now() - startedAt) / 1000;

  // Only finalize (read back + namespace) when the raw report was written;
  // if the Cargo write already failed there is nothing to finalize.
  if (reportingError === undefined) {
    const completed = await completeJUnitReport({
      runner: step.runner,
      reportPath,
      workspace: workspace.package,
      name,
      durationSeconds,
      exitCode,
    });
    reportingError = completed.reportingError;
  }

  const coveragePath = expectedCoveragePath(step, rawCoverageDirectory);
  if (
    coveragePath !== undefined &&
    fallbackCoveragePath !== undefined &&
    !(await Bun.file(coveragePath).exists()) &&
    (await Bun.file(fallbackCoveragePath).exists())
  ) {
    await Bun.write(coveragePath, Bun.file(fallbackCoveragePath));
  }

  if (exitCode !== 0) {
    if (reportingError !== undefined) {
      console.error(
        "%s test process exited with status %d, and its JUnit report could not be finalized:",
        workspace.package,
        exitCode,
        reportingError,
      );
    }
    process.exit(exitCode);
  }
  if (reportingError !== undefined) {
    throw reportingError;
  }

  if (coverageEnabled && coveragePath !== undefined) {
    const file = Bun.file(coveragePath);
    if (!(await file.exists()) || file.size === 0) {
      throw new Error(
        `${workspace.package} step ${name} emitted no coverage report at ${coveragePath}`,
      );
    }
  }
}
