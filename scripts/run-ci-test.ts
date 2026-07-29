import path from "node:path";
import {
  applyDefaultEnvironment,
  cargoTestJUnit,
  completeJUnitReport,
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
const workspaceDirectory = path.relative(repositoryRoot, process.cwd());
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

function commandForStep(
  step: TestStep,
  reportPath: string,
  rawCoverageDirectory: string,
): string[] {
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
    case "command":
      return step.command;
  }
}

function expectedCoveragePath(
  step: TestStep,
  rawCoverageDirectory: string,
): string | undefined {
  switch (step.runner) {
    case "bun":
    case "vitest":
      return path.join(rawCoverageDirectory, "lcov.info");
    case "go":
      return path.join(rawCoverageDirectory, "coverage.out");
    case "cargo":
    case "command":
      return undefined;
  }
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
  if (coverageEnabled && step.runner !== "cargo" && step.runner !== "command") {
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
  const command = commandForStep(step, reportPath, rawCoverageDirectory);
  let exitCode: number;
  let reportingError: Error | undefined;
  if (step.runner === "cargo") {
    const child = Bun.spawn(command, {
      cwd: process.cwd(),
      env: environment,
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
      env: environment,
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
    !(await Bun.file(coveragePath).exists()) &&
    fallbackCoveragePath !== undefined &&
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
