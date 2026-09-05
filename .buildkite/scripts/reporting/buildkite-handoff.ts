export const INLINE_HANDOFF_LIMIT_BYTES = 1024;
export const BUILD_METADATA_LIMIT_BYTES = 100 * 1024;

export type BuildkiteCommandRunner = (
  argumentsList: readonly string[],
) => Promise<number>;

export type WriteJsonHandoffOptions = {
  readonly producingJobId?: string;
  readonly runner?: BuildkiteCommandRunner;
};

const ARTIFACT_NAME_PATTERN = /^\w[\w.-]*\.json$/u;
const BUILDKITE_JOB_ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function handoffValue(
  value: unknown,
  artifactName: string,
  producingJobId?: string,
): {
  readonly serialized: string;
  readonly metadata: string;
  readonly artifactName: string;
  readonly useArtifact: boolean;
} {
  if (!ARTIFACT_NAME_PATTERN.test(artifactName)) {
    throw new Error(`invalid Buildkite handoff artifact name: ${artifactName}`);
  }
  const serialized = `${JSON.stringify(value)}\n`;
  const bytes = byteLength(serialized);
  const useArtifact = bytes > INLINE_HANDOFF_LIMIT_BYTES;
  if (!useArtifact) {
    return {
      serialized,
      metadata: serialized.trimEnd(),
      artifactName,
      useArtifact,
    };
  }
  if (
    producingJobId === undefined ||
    !BUILDKITE_JOB_ID_PATTERN.test(producingJobId)
  ) {
    throw new Error(
      "BUILDKITE_JOB_ID must be a valid UUID for artifact-backed handoffs",
    );
  }
  const scopedArtifactName = `${artifactName.slice(0, -".json".length)}.${producingJobId}.json`;
  return {
    serialized,
    metadata: `artifact:${producingJobId}:${scopedArtifactName}`,
    artifactName: scopedArtifactName,
    useArtifact,
  };
}

async function runBuildkiteAgent(
  argumentsList: readonly string[],
): Promise<number> {
  const child = Bun.spawn(["buildkite-agent", ...argumentsList], {
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

export async function writeJsonHandoff(
  key: string,
  artifactName: string,
  value: unknown,
  options: WriteJsonHandoffOptions = {},
): Promise<void> {
  const runner = options.runner ?? runBuildkiteAgent;
  const producingJobId = options.producingJobId ?? Bun.env["BUILDKITE_JOB_ID"];
  const handoff = handoffValue(value, artifactName, producingJobId);
  if (handoff.useArtifact) {
    await Bun.write(handoff.artifactName, handoff.serialized);
    if ((await runner(["artifact", "upload", handoff.artifactName])) !== 0) {
      throw new Error(
        `could not upload Buildkite handoff artifact ${handoff.artifactName}`,
      );
    }
  }
  if ((await runner(["meta-data", "set", key, handoff.metadata])) !== 0) {
    throw new Error(`could not set Buildkite handoff metadata ${key}`);
  }
}
