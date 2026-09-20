import {
  builderCreateCommand,
  builtImageDigest,
  ciImageBuildCommand,
  ciImageDefinition,
  ciImageSourceFingerprint,
  type CiImageCandidate,
} from "./build-ci-image-core.ts";
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

function requiredArgument(
  commandArguments: readonly string[],
  name: string,
): string {
  const index = commandArguments.indexOf(name);
  const value = index === -1 ? undefined : commandArguments[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (import.meta.main) {
  const commandArguments = Bun.argv.slice(2);
  const definition = ciImageDefinition(
    requiredArgument(commandArguments, "--image"),
  );
  const candidateOut = requiredArgument(commandArguments, "--candidate-out");
  const knownArguments = new Set(["--image", "--candidate-out"]);
  for (let index = 0; index < commandArguments.length; index += 2) {
    const flag = commandArguments[index];
    if (flag === undefined || !knownArguments.has(flag)) {
      throw new Error(`Unknown argument ${flag ?? ""}`);
    }
  }
  const sourceCommit = Bun.env["BUILDKITE_COMMIT"];
  if (sourceCommit === undefined || !/^[\da-f]{40}$/.test(sourceCommit)) {
    throw new Error("BUILDKITE_COMMIT must be a full lowercase commit SHA");
  }
  const rawBuildNumber = Bun.env["BUILDKITE_BUILD_NUMBER"];
  const buildNumber = Number(rawBuildNumber);
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new Error("BUILDKITE_BUILD_NUMBER must be a positive integer");
  }
  const sourceFingerprint = await ciImageSourceFingerprint(definition);
  const metadataFile = `/tmp/${definition.name}-buildx-metadata-${buildNumber.toString()}.json`;
  const inspect = await execute(["docker", "buildx", "inspect", "ci"]);
  if (inspect.exitCode !== 0) {
    const create = await execute(builderCreateCommand);
    if (create.exitCode !== 0) {
      throw new Error("Could not create the remote BuildKit builder");
    }
  }
  const buildExitCode = await retryTransientBuildx(() =>
    execute(
      ciImageBuildCommand(
        definition.repository,
        definition.dockerfile,
        sourceFingerprint,
        metadataFile,
      ),
    ),
  );
  if (buildExitCode === 34) process.exit(buildExitCode);
  if (buildExitCode !== 0) {
    throw new Error(`CI image build failed for ${definition.repository}`);
  }
  const digest = builtImageDigest(await Bun.file(metadataFile).json());
  const candidate: CiImageCandidate = {
    schema: "ci-image-candidate/v1",
    image: definition.name,
    buildNumber,
    sourceCommit,
    sourceFingerprint: `sha256:${sourceFingerprint}`,
    digest,
  };
  await Bun.write(candidateOut, `${JSON.stringify(candidate, null, 2)}\n`);
  await Bun.$`rm ${metadataFile}`.quiet();
  console.log(
    `Built ${definition.name} candidate ${digest} from sha256:${sourceFingerprint}`,
  );
}
