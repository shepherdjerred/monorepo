/**
 * Build-scoped handoff store for CI steps.
 *
 * Buildkite supplied two mechanisms this pipeline depends on: a build-scoped
 * metadata KV (`buildkite-agent meta-data`) and an artifact store
 * (`buildkite-agent artifact`). Woodpecker provides neither, so both collapse
 * into one SeaweedFS-backed object store keyed by pipeline number.
 *
 * The old size-dependent split disappears with them. `buildkite-handoff.ts`
 * stored values up to 1 KiB inline in metadata and spilled anything larger to
 * an artifact, leaving readers to resolve an `artifact:<jobId>:<file>` pointer.
 * Every value now takes the same path regardless of size, so there is no
 * pointer format, no producing-job identifier, and no second failure mode.
 */

import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import { requireEnv } from "../run.ts";
import { SEAWEEDFS_ENDPOINT } from "../seaweedfs.ts";

export const CI_HANDOFF_BUCKET = "ci-handoff";

/**
 * SeaweedFS requires s3v4 signing against a pinned region; `us-east-1` matches
 * `SEAWEEDFS_AWS_ENV` so CLI and signed-request callers agree.
 */
export const CI_HANDOFF_REGION = "us-east-1";

const HANDOFF_KEY_PATTERN = /^\w[\w.-]*$/u;
const PIPELINE_NUMBER_PATTERN = /^\d+$/u;

export type CiHandoffConfig = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly pipelineNumber: string;
};

export type HandoffFetch = (request: Request) => Promise<Response>;

/**
 * Object key for one handoff value.
 *
 * Both components are validated rather than escaped: a key that needs escaping
 * is a caller bug, and silently rewriting it would let two distinct keys share
 * one object.
 */
export function handoffObjectKey(pipelineNumber: string, key: string): string {
  if (!PIPELINE_NUMBER_PATTERN.test(pipelineNumber)) {
    throw new Error(`invalid CI handoff pipeline number: ${pipelineNumber}`);
  }
  if (!HANDOFF_KEY_PATTERN.test(key)) {
    throw new Error(`invalid CI handoff key: ${key}`);
  }
  return `${pipelineNumber}/${key}.json`;
}

export function ciHandoffConfigFromEnv(): CiHandoffConfig {
  return {
    accessKeyId: requireEnv("SEAWEEDFS_HANDOFF_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY"),
    endpoint: SEAWEEDFS_ENDPOINT,
    bucket: CI_HANDOFF_BUCKET,
    region: CI_HANDOFF_REGION,
    pipelineNumber: requireEnv("CI_PIPELINE_NUMBER"),
  };
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

/**
 * Publish a handoff value for later steps in the same pipeline.
 *
 * The trailing newline matches the previous artifact format so consumers that
 * pipe the raw body into `jq` or a shell variable behave identically.
 */
export async function writeJsonHandoff(
  key: string,
  value: unknown,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<void> {
  const objectKey = handoffObjectKey(config.pipelineNumber, key);
  const request = createSignedS3Request(signingConfig(config), {
    method: "PUT",
    key: objectKey,
    body: `${JSON.stringify(value)}\n`,
    contentType: "application/json",
  });
  const response = await fetchImpl(request);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `could not publish CI handoff ${key} (${response.status.toString()}): ${body}`,
    );
  }
}

/**
 * Read a handoff value, requiring the producing step to have written it.
 *
 * Defaulting the value would make a handoff that never happened — a producer
 * regression, or a step that failed before publishing — indistinguishable from
 * a producer that ran and had nothing to hand off. Consumers read that empty
 * map as "no images to release", so `helm-push` and `argocd-sync` would skip
 * the release and the version commit-back would no-op the pin, and the build
 * would go green having deployed nothing. Every consumer of these keys depends
 * on the producing step, and that step writes them on both its build and its
 * skip path, so an absent key means the contract broke and must fail loudly.
 */
/**
 * Read a handoff value that the producing step may legitimately not have
 * published.
 *
 * Use this ONLY where an absent value is a real outcome rather than a broken
 * contract -- a producer that ran and correctly decided there was nothing to
 * hand off. Everything else must use `readRequiredHandoff`, because a
 * defaulted value turns a producer regression into a green build that did
 * nothing.
 *
 * A missing object returns undefined; any other failure still throws, so a
 * credential or network problem is never mistaken for "nothing to do".
 */
export async function readOptionalHandoff(
  key: string,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<string | undefined> {
  const objectKey = handoffObjectKey(config.pipelineNumber, key);
  const request = createSignedS3Request(signingConfig(config), {
    method: "GET",
    key: objectKey,
  });
  const response = await fetchImpl(request);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `could not read CI handoff ${key} (${response.status.toString()})`,
    );
  }
  return response.text();
}

export async function readRequiredHandoff(
  key: string,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<string> {
  const objectKey = handoffObjectKey(config.pipelineNumber, key);
  const request = createSignedS3Request(signingConfig(config), {
    method: "GET",
    key: objectKey,
  });
  const response = await fetchImpl(request);
  if (!response.ok) {
    throw new Error(
      `required CI handoff ${key} is missing (${response.status.toString()}); ` +
        "the producing step did not publish it",
    );
  }
  return response.text();
}
