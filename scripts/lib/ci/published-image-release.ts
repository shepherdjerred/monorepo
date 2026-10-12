import { z } from "zod";
import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import { parseVersionCatalogText } from "../../../packages/version-catalog/src/index.ts";
import { parsePinCandidates } from "../pin-candidates-schema.ts";
import {
  ciHandoffConfigFromEnv,
  readRequiredHandoff,
  type CiHandoffConfig,
  type HandoffFetch,
} from "./ci-handoff.ts";
import {
  resolveImageReleaseCatalog,
  retainPublishedImagePins,
  type LiveCatalogExecutor,
} from "../../../ci/scripts/images/live-version-catalog.ts";

const RELEASE_KEY = "published-images/main.json";
const ReleaseSchema = z
  .object({
    schema: z.literal("published-image-release/v1"),
    pipelineNumber: z.number().int().positive(),
    commit: z.string().regex(/^[a-f\d]{40}$/u),
    versionCatalog: z.string().min(1),
    pinCandidates: z.string().min(1),
  })
  .strict();
export type PublishedImageRelease = z.infer<typeof ReleaseSchema>;

function validateRelease(value: unknown): PublishedImageRelease {
  const release = ReleaseSchema.parse(value);
  parseVersionCatalogText(release.versionCatalog);
  const batch = parsePinCandidates(release.pinCandidates);
  if (
    Object.values(batch.candidates).some(
      (pin) => pin.gitSha !== undefined && pin.gitSha !== release.commit,
    )
  ) {
    throw new Error("Published candidate source differs from the release");
  }
  retainPublishedImagePins(
    release.versionCatalog,
    release.versionCatalog,
    release.pinCandidates,
  );
  return release;
}

function signingConfig(config: CiHandoffConfig) {
  return { ...config, forcePathStyle: true };
}

export async function readPublishedImageRelease(
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<PublishedImageRelease | undefined> {
  const response = await fetchImpl(
    new Request(
      createSignedS3Request(signingConfig(config), {
        method: "GET",
        key: RELEASE_KEY,
        signal: AbortSignal.timeout(20_000),
      }),
      { redirect: "error" },
    ),
  );
  // Only the first publisher after protocol deployment has no head yet.
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(
      `Cannot read published image release (${response.status.toString()})`,
    );
  return validateRelease(await response.json());
}

/** Called only inside Woodpecker's repository-wide image-push group (limit 1). */
export async function writePublishedImageRelease(
  value: PublishedImageRelease,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<void> {
  const release = validateRelease(value);
  if (release.pipelineNumber !== Number(config.pipelineNumber))
    throw new Error("Published image release does not belong to this pipeline");
  const previous = await readPublishedImageRelease(config, fetchImpl);
  if (
    previous !== undefined &&
    previous.pipelineNumber >= release.pipelineNumber
  ) {
    if (JSON.stringify(previous) === JSON.stringify(release)) return;
    throw new Error(
      "Refusing to overwrite an equal or newer image publication",
    );
  }
  const response = await fetchImpl(
    new Request(
      createSignedS3Request(signingConfig(config), {
        method: "PUT",
        key: RELEASE_KEY,
        body: JSON.stringify(release),
        contentType: "application/json",
        signal: AbortSignal.timeout(20_000),
      }),
      { redirect: "error" },
    ),
  );
  if (!response.ok)
    throw new Error(
      `Cannot publish image release (${response.status.toString()})`,
    );
}

export async function resolvePublishedImageCatalog(
  commit: string,
  executor: LiveCatalogExecutor,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  dependencies: {
    readLatest?: () => Promise<PublishedImageRelease | undefined>;
    readHandoff?: (key: string, pipelineNumber: string) => Promise<string>;
  } = {},
): Promise<{ catalog: string; baseCommit: string | undefined }> {
  const latest = await (dependencies.readLatest ?? readPublishedImageRelease)();
  if (latest === undefined)
    return resolveImageReleaseCatalog(
      commit,
      executor,
      environment,
      dependencies.readHandoff,
    );
  const currentPipeline = z.coerce
    .number()
    .int()
    .positive()
    .parse(environment["CI_PIPELINE_NUMBER"]);
  if (latest.pipelineNumber >= currentPipeline) {
    throw new Error(
      "This image pipeline is already published or superseded; recover with a new full main pipeline",
    );
  }
  const release = await resolveImageReleaseCatalog(
    commit,
    executor,
    {
      ...environment,
      CI_LAST_IMAGE_RELEASE_COMMIT: latest.commit,
      CI_LAST_IMAGE_RELEASE_PIPELINE: latest.pipelineNumber.toString(),
    },
    (key, pipeline) => {
      if (pipeline !== latest.pipelineNumber.toString())
        throw new Error("Published image release identity changed");
      if (key === "version-catalog")
        return Promise.resolve(latest.versionCatalog);
      if (key === "pin-candidates")
        return Promise.resolve(latest.pinCandidates);
      throw new Error(`Unexpected published image handoff ${key}`);
    },
  );
  if (release.baseCommit !== latest.commit)
    throw new Error(
      "Latest image publication is outside the current source ancestry",
    );
  return release;
}

/** Atomically retain both completed handoffs after every successful image push. */
export async function recordPublishedImageRelease(
  commit: string,
  buildNumber: string,
  config: CiHandoffConfig = ciHandoffConfigFromEnv(),
  fetchImpl: HandoffFetch = fetch,
): Promise<void> {
  const [versionCatalog, pinCandidates] = await Promise.all([
    readRequiredHandoff("version-catalog", config, fetchImpl),
    readRequiredHandoff("pin-candidates", config, fetchImpl),
  ]);
  if (parsePinCandidates(pinCandidates).buildNumber !== Number(buildNumber))
    throw new Error("Published candidates do not belong to this release");
  await writePublishedImageRelease(
    {
      schema: "published-image-release/v1",
      pipelineNumber: Number(config.pipelineNumber),
      commit,
      versionCatalog,
      pinCandidates,
    },
    config,
    fetchImpl,
  );
}
