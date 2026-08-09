import { writeFile } from "node:fs/promises";

export const INLINE_HANDOFF_LIMIT_BYTES = 1024;
export const BUILD_METADATA_LIMIT_BYTES = 100 * 1024;

export type BuildkiteCommandRunner = (
  argumentsList: readonly string[],
) => Promise<number>;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function handoffValue(
  value: unknown,
  artifactName: string,
): {
  readonly serialized: string;
  readonly metadata: string;
  readonly useArtifact: boolean;
} {
  if (!/^\w[\w.-]*\.json$/.test(artifactName)) {
    throw new Error(`invalid Buildkite handoff artifact name: ${artifactName}`);
  }
  const serialized = `${JSON.stringify(value)}\n`;
  const bytes = byteLength(serialized);
  return {
    serialized,
    metadata:
      bytes <= INLINE_HANDOFF_LIMIT_BYTES
        ? serialized.trimEnd()
        : `artifact:${artifactName}`,
    useArtifact: bytes > INLINE_HANDOFF_LIMIT_BYTES,
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
  runner: BuildkiteCommandRunner = runBuildkiteAgent,
): Promise<void> {
  const handoff = handoffValue(value, artifactName);
  if (handoff.useArtifact) {
    await writeFile(artifactName, handoff.serialized, "utf8");
    if ((await runner(["artifact", "upload", artifactName])) !== 0) {
      throw new Error(
        `could not upload Buildkite handoff artifact ${artifactName}`,
      );
    }
  }
  if ((await runner(["meta-data", "set", key, handoff.metadata])) !== 0) {
    throw new Error(`could not set Buildkite handoff metadata ${key}`);
  }
}
