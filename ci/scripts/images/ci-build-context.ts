import type { PublishBuild } from "../../../packages/delivery/src/shared/contract.ts";
import { requireEnv, run } from "../../../scripts/lib/run.ts";

/** The exact main pipeline a `ci` service build is registered from. */
export type CiBuildContext = {
  readonly repositoryId: number;
  readonly pipelineNumber: number;
  readonly releaseNumber: number;
  readonly sourceRevision: string;
  readonly ciUrl: string;
  readonly verifiedAt: string;
};
export type RegistrationClient = {
  publish: (
    input: PublishBuild,
  ) => Promise<{ buildId: string; artifacts: string[] }>;
};
/** Reads an image's raw manifest bytes from its registry by exact reference. */
export type ManifestInspector = (reference: string) => Promise<string>;

function positiveInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

/** The running Woodpecker pipeline, which the independent qualifier later verifies. */
export function ciBuildContextFromEnv(): CiBuildContext {
  return {
    repositoryId: positiveInteger("CI_REPO_ID", requireEnv("CI_REPO_ID")),
    pipelineNumber: positiveInteger(
      "CI_PIPELINE_NUMBER",
      requireEnv("CI_PIPELINE_NUMBER"),
    ),
    releaseNumber: positiveInteger(
      "CI_RELEASE_NUMBER",
      requireEnv("CI_RELEASE_NUMBER"),
    ),
    sourceRevision: requireEnv("CI_COMMIT_SHA"),
    ciUrl: requireEnv("CI_PIPELINE_URL"),
    verifiedAt: new Date().toISOString(),
  };
}

/** Every request and artifact id one pipeline registers starts with this. */
export function pipelinePrefix(context: CiBuildContext): string {
  return `ci/${String(context.repositoryId)}/${String(context.pipelineNumber)}`;
}

export async function inspectManifest(reference: string): Promise<string> {
  const result = await run(
    ["docker", "buildx", "imagetools", "inspect", "--raw", reference],
    { capture: true, echoCapturedStdout: false },
  );
  return result.stdout;
}
