import path from "node:path";
import {
  applyDefaultEnvironment,
  cargoTestJUnit,
  completeJUnitReport,
  removeExistingReport,
  sanitizeWorkspace,
  TestManifestSchema,
  type TestStep,
} from "./ci-reporting.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const manifest = TestManifestSchema.parse(
  await Bun.file(path.join(import.meta.dir, "ci-test-manifest.json")).json(),
);
const workspaceDirectory = path.relative(repositoryRoot, process.cwd());
const workspace = manifest.workspaces.find(
  (entry) => entry.directory === workspaceDirectory,
);

if (workspace === undefined) {
  throw new Error(
    `No CI test reporting entry exists for workspace ${workspaceDirectory}`,
  );
}

const outputDirectory = path.join(
  repositoryRoot,
  ".ci-reports",
  "junit",
  sanitizeWorkspace(workspace.package),
);
await Bun.$`mkdir -p ${outputDirectory}`;

const environment = { ...Bun.env };
applyDefaultEnvironment(environment, workspace.defaultEnv ?? {});

function reportName(step: TestStep, index: number): string {
  return step.name ?? `${step.runner}-${(index + 1).toString()}`;
}

function commandForStep(step: TestStep, reportPath: string): string[] {
  switch (step.runner) {
    case "bun":
      return [
        "bun",
        ...(step.bunArgs ?? []),
        "test",
        ...(step.args ?? []),
        "--reporter=junit",
        `--reporter-outfile=${reportPath}`,
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
      ];
    case "cargo":
      return ["cargo", "test", ...step.args, "--", "--format", "pretty"];
    case "command":
      return step.command;
  }
}

for (const [index, step] of workspace.steps.entries()) {
  const name = reportName(step, index);
  const reportPath = path.resolve(outputDirectory, `${name}.xml`);
  await removeExistingReport(reportPath);
  const startedAt = performance.now();
  const command = commandForStep(step, reportPath);
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
}
