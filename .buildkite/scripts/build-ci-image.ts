import { builderCreateCommand, ciImageBuildCommand } from "./migration-core.ts";
import {
  retryTransientBuildx,
  type BuildxCommandResult,
} from "./bake-retry.ts";

const outputTailLimit = 128 * 1024;

async function teeOutputTail(
  stream: ReadableStream<Uint8Array>,
  destination: NodeJS.WriteStream,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    destination.write(value);
    tail += decoder.decode(value, { stream: true });
    if (tail.length > outputTailLimit) {
      tail = tail.slice(-outputTailLimit);
    }
  }
  tail += decoder.decode();
  return tail;
}

async function execute(
  command: readonly string[],
): Promise<BuildxCommandResult> {
  const child = Bun.spawn([...command], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    teeOutputTail(child.stdout, process.stdout),
    teeOutputTail(child.stderr, process.stderr),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

if (import.meta.main) {
  const commit = Bun.env["BUILDKITE_COMMIT"];
  if (commit === undefined) throw new Error("BUILDKITE_COMMIT is required");
  const inspect = await execute(["docker", "buildx", "inspect", "ci"]);
  if (inspect.exitCode !== 0) {
    const create = await execute(builderCreateCommand);
    if (create.exitCode !== 0) {
      throw new Error("Could not create the remote BuildKit builder");
    }
  }
  for (const [image, dockerfile] of [
    ["ghcr.io/shepherdjerred/ci-base", ".buildkite/ci-image/Dockerfile"],
    [
      "ghcr.io/shepherdjerred/ci-playwright",
      ".buildkite/ci-playwright/Dockerfile",
    ],
  ] as const) {
    const buildExitCode = await retryTransientBuildx(() =>
      execute(ciImageBuildCommand(image, dockerfile, commit)),
    );
    if (buildExitCode === 34) process.exit(buildExitCode);
    if (buildExitCode !== 0) {
      throw new Error(`CI image build failed for ${image}`);
    }
  }
}
