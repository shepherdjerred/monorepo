/**
 * Build-scoped binary artifact transfer.
 *
 * The JSON handoff store carries the small structured values steps pass each
 * other. This carries the ones that are directory trees: the prebuilt site
 * bundles and the resume PDF, which the deploy lane consumes with
 * `--prebuilt` rather than rebuilding.
 *
 * Same SeaweedFS bucket, under a separate prefix so a tarball can never be
 * mistaken for a handoff document. Contents are tar+gzip rather than
 * individual objects because the consumer wants the tree restored exactly,
 * including empty directories and file modes.
 */

import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import {
  ciHandoffConfigFromEnv,
  type CiHandoffConfig,
  type HandoffFetch,
} from "./ci-handoff.ts";

const ARTIFACT_PREFIX = "artifacts";
const ARTIFACT_KEY_PATTERN = /^\w[\w.-]*$/u;
const PIPELINE_NUMBER_PATTERN = /^\d+$/u;

export function artifactObjectKey(pipelineNumber: string, key: string): string {
  if (!PIPELINE_NUMBER_PATTERN.test(pipelineNumber)) {
    throw new Error(`invalid CI artifact pipeline number: ${pipelineNumber}`);
  }
  if (!ARTIFACT_KEY_PATTERN.test(key)) {
    throw new Error(`invalid CI artifact key: ${key}`);
  }
  return `${ARTIFACT_PREFIX}/${pipelineNumber}/${key}.tar.gz`;
}

function signingConfig(config: CiHandoffConfig) {
  return {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    endpoint: config.endpoint,
    bucket: config.bucket,
    region: config.region,
    forcePathStyle: true,
  };
}

async function run(command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `${command[0] ?? "command"} failed (exit ${exitCode.toString()})`,
    );
  }
}

/**
 * Archive `paths` and publish them under `key`.
 *
 * The archive is built to a file rather than streamed because SigV4 signs a
 * hash of the complete payload, so the bytes have to exist before the request
 * can be made.
 */
export async function putCiArtifact(
  key: string,
  paths: readonly string[],
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<void> {
  if (paths.length === 0) {
    throw new Error(`refusing to publish an empty CI artifact for ${key}`);
  }
  const archive = `${Bun.env["TMPDIR"] ?? "/tmp"}/ci-artifact-${key}.tar.gz`;
  await run(["tar", "-czf", archive, ...paths]);

  const body = await Bun.file(archive).bytes();
  const request = createSignedS3Request(signingConfig(config), {
    method: "PUT",
    key: artifactObjectKey(config.pipelineNumber, key),
    body,
    contentType: "application/gzip",
  });
  const response = await fetchImpl(request);
  if (!response.ok) {
    throw new Error(
      `could not publish CI artifact ${key} (${response.status.toString()})`,
    );
  }
}

/**
 * Restore an artifact into the working directory.
 *
 * Fails loudly when absent. Every consumer of these deploys what it restores,
 * so a missing archive must stop the deploy rather than let it publish
 * whatever happens to be on disk.
 */
export async function getCiArtifact(
  key: string,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<void> {
  const request = createSignedS3Request(signingConfig(config), {
    method: "GET",
    key: artifactObjectKey(config.pipelineNumber, key),
  });
  const response = await fetchImpl(request);
  if (!response.ok) {
    throw new Error(
      `required CI artifact ${key} is missing (${response.status.toString()}); ` +
        "the producing step did not publish it",
    );
  }
  const archive = `${Bun.env["TMPDIR"] ?? "/tmp"}/ci-artifact-${key}.tar.gz`;
  await Bun.write(archive, await response.bytes());
  await run(["tar", "-xzf", archive]);
}
