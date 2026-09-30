import {
  builderCreateCommand,
  ciImageDefinition,
  ciImageSelftestCommand,
} from "./build-ci-image-core.ts";
import { retryTransientBuildx } from "./bake-retry.ts";

// Builds the windows-cross-compiler self-tests on pull requests. Each self-test
// compiles the package samples in the image it tests and fails the solve when
// a check fails; the logs are exported for the step's artifacts and nothing is
// pushed.
const REPORT_TARGET = "selftest-report";
const REPORT_DIRECTORY = "windows-cross-compiler-selftest";

async function execute(command: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = Bun.spawn([...command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "pipe",
  });
  const stderr = await new Response(child.stderr).text();
  process.stderr.write(stderr);
  return { exitCode: await child.exited, stdout: "", stderr };
}

if (import.meta.main) {
  const definitions = [
    ciImageDefinition("windows-cross-compiler"),
    ciImageDefinition("windows-cross-compiler-winui"),
  ];
  const inspect = await execute(["docker", "buildx", "inspect", "ci"]);
  if (inspect.exitCode !== 0) {
    const create = await execute(builderCreateCommand);
    if (create.exitCode !== 0) {
      throw new Error("Could not create the remote BuildKit builder");
    }
  }
  const exitCode = await retryTransientBuildx(() =>
    execute(
      ciImageSelftestCommand(definitions, REPORT_TARGET, REPORT_DIRECTORY),
    ),
  );
  if (exitCode === 34) process.exit(exitCode);
  if (exitCode !== 0) {
    throw new Error("windows-cross-compiler self-tests failed");
  }
}
