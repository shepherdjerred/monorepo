#!/usr/bin/env bun

export type ArtifactDownloadRunner = (
  artifactName: string,
  producingJobId: string,
) => Promise<number>;

export type ArtifactPointer = {
  artifactName: string;
  producingJobId: string;
};

const ARTIFACT_NAME_PATTERN = /^\w[\w.-]*\.json$/u;
const BUILDKITE_JOB_ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

export function requiredArgument(
  argumentsList: readonly string[],
  index: number,
  name: string,
): string {
  const value = argumentsList[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * Read a handoff key, requiring the producing step to have written it.
 *
 * Defaulting the value would make a handoff that never happened — a producer
 * regression, or a step that failed before publishing — indistinguishable from
 * a producer that ran and had nothing to hand off. Consumers read that empty
 * map as "no images to release", so `helm-push` and `argocd-sync` would skip
 * the release and `version-commit-back` would no-op the pin, and the build
 * would go green having deployed nothing. Every consumer of these keys
 * `depends_on: images`, and that step writes them on both its build and its
 * skip path, so an absent key means the contract broke and must fail loudly.
 */
export async function readRequiredMetadata(key: string): Promise<string> {
  const child = Bun.spawn(["buildkite-agent", "meta-data", "get", key], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const valueText = await new Response(child.stdout).text();
  const value = valueText.trim();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `required Buildkite handoff metadata ${key} is missing (exit ${exitCode.toString()}); ` +
        "the producing step did not publish it",
    );
  }
  return value;
}

export function artifactPointerFromMetadata(
  value: string,
): ArtifactPointer | undefined {
  if (!value.startsWith("artifact:")) return undefined;
  const [producingJobId, artifactName, ...extra] = value
    .slice("artifact:".length)
    .split(":");
  if (
    producingJobId === undefined ||
    artifactName === undefined ||
    extra.length > 0 ||
    !BUILDKITE_JOB_ID_PATTERN.test(producingJobId) ||
    !ARTIFACT_NAME_PATTERN.test(artifactName) ||
    !artifactName.endsWith(`.${producingJobId}.json`)
  ) {
    throw new Error(`invalid Buildkite handoff artifact pointer ${value}`);
  }
  return { artifactName, producingJobId };
}

async function downloadArtifact(
  name: string,
  producingJobId: string,
): Promise<number> {
  const child = Bun.spawn(
    [
      "buildkite-agent",
      "artifact",
      "download",
      name,
      ".",
      // `artifact download --step` scopes the search and accepts "the step's
      // key or label, or a Job ID" (buildkite-agent v3.134 flag help; the
      // command description points explicitly at $BUILDKITE_JOB_ID). The
      // download command has no --job flag at all — that one is upload-only —
      // so the producing job UUID in the pointer is the correct scope here.
      "--step",
      producingJobId,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  return child.exited;
}

export async function readHandoffValue(
  value: string,
  downloader: ArtifactDownloadRunner = downloadArtifact,
): Promise<string> {
  const pointer = artifactPointerFromMetadata(value);
  if (pointer === undefined) return `${value}\n`;
  if ((await downloader(pointer.artifactName, pointer.producingJobId)) !== 0) {
    throw new Error(
      `could not download Buildkite handoff artifact ${pointer.artifactName}`,
    );
  }
  return Bun.file(pointer.artifactName).text();
}

async function main(): Promise<void> {
  const key = requiredArgument(Bun.argv, 2, "metadata key");
  const value = await readRequiredMetadata(key);
  process.stdout.write(await readHandoffValue(value));
}

if (import.meta.main) await main();
