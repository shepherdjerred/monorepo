/** Fixed, manifest-verified binary artifact transfer for CI builds. */
import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import {
  artifactDefinition,
  createCiArtifactArchive,
  restoreCiArtifactArchive,
} from "./ci-artifact-archive.ts";
import {
  CiObjectStoreHttpError,
  withCiObjectStoreRetry,
} from "./ci-object-store-retry.ts";
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
  artifactDefinition(key);
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

export async function putCiArtifact(
  key: string,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
  repositoryRoot = process.cwd(),
): Promise<void> {
  const body = await createCiArtifactArchive(key, repositoryRoot);
  const objectKey = artifactObjectKey(config.pipelineNumber, key);
  await withCiObjectStoreRetry(async () => {
    const request = createSignedS3Request(signingConfig(config), {
      method: "PUT",
      key: objectKey,
      body,
      contentType: "application/gzip",
    });
    const response = await fetchImpl(request);
    if (!response.ok) {
      throw new CiObjectStoreHttpError(
        `could not publish CI artifact ${key} (HTTP ${response.status.toString()})`,
        response.status,
      );
    }
    await response.body?.cancel();
  });
}

export async function getCiArtifact(
  key: string,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
  repositoryRoot = process.cwd(),
): Promise<void> {
  const objectKey = artifactObjectKey(config.pipelineNumber, key);
  const body = await withCiObjectStoreRetry(async () => {
    const request = createSignedS3Request(signingConfig(config), {
      method: "GET",
      key: objectKey,
    });
    const response = await fetchImpl(request);
    if (!response.ok) {
      throw new CiObjectStoreHttpError(
        `could not restore required CI artifact ${key} (HTTP ${response.status.toString()})`,
        response.status,
      );
    }
    return response.bytes();
  });
  await restoreCiArtifactArchive(key, body, repositoryRoot);
}
