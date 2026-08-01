import { optionalEnv, requireEnv, run, runAllowExit, tmpBase } from "./run.ts";
import { z } from "zod";
import {
  assertS3ObjectsMatchSource,
  assertStaticSiteComplete,
  firstS3ObjectMismatch,
  isMissingS3Object,
  s3SyncStaticSite,
  SEAWEEDFS_AWS_ENV,
  SEAWEEDFS_ENDPOINT,
} from "./s3-static-site.ts";
import {
  CANONICAL_DIGEST_PATTERN,
  parseLegacyScoutReleaseManifest,
  SCOUT_VERSION_PATTERN,
} from "./scout-release-state.ts";
import { SCOUT_RELEASES_BUCKET } from "./scout-site-storage.ts";

const PROD_BUCKET = "scout-frontend";
const MARKER_KEY = ".release-version";
const IMMUTABLE_PREFIXES = ["_astro/", "app/assets/"];
const RELEASE_ENTRYPOINTS = ["index.html", "app/index.html"] as const;
const ImageManifestSchema = z.looseObject({
  digest: z.string().regex(CANONICAL_DIGEST_PATTERN),
});

function root(): string {
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

function haveCreds(): boolean {
  return (
    optionalEnv("AWS_ACCESS_KEY_ID") !== null &&
    optionalEnv("AWS_SECRET_ACCESS_KEY") !== null
  );
}

function requireCreds(dryRun: boolean): void {
  if (!dryRun && !haveCreds()) {
    requireEnv("AWS_ACCESS_KEY_ID");
    requireEnv("AWS_SECRET_ACCESS_KEY");
  }
}

async function readOptionalObject(
  bucket: string,
  key: string,
): Promise<string | null> {
  const result = await runAllowExit(
    [
      "aws",
      "s3",
      "cp",
      `s3://${bucket}/${key}`,
      "-",
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV, capture: true },
  );
  if (result.exitCode === 0) {
    return result.stdout;
  }
  if (isMissingS3Object(result.stderr)) {
    return null;
  }
  throw new Error(`failed to read s3://${bucket}/${key}: ${result.stderr}`);
}

async function writeMarker(version: string): Promise<void> {
  const file = `${tmpBase()}/scout-legacy-marker-${process.pid.toString()}`;
  try {
    await Bun.write(file, `${version}\n`);
    await run(
      [
        "aws",
        "s3",
        "cp",
        file,
        `s3://${PROD_BUCKET}/${MARKER_KEY}`,
        "--endpoint-url",
        SEAWEEDFS_ENDPOINT,
        "--cache-control",
        "no-cache",
      ],
      { env: SEAWEEDFS_AWS_ENV },
    );
  } finally {
    await Bun.file(file).delete();
  }
}

export function parseScoutImageManifestDigest(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error("Scout image manifest is not valid JSON", { cause: error });
  }
  return ImageManifestSchema.parse(parsed).digest;
}

async function resolveLegacyTagDigest(version: string): Promise<string> {
  const result = await run(
    [
      "docker",
      "buildx",
      "imagetools",
      "inspect",
      `ghcr.io/shepherdjerred/scout-for-lol:${version}`,
      "--format",
      "{{json .Manifest}}",
    ],
    { capture: true },
  );
  return parseScoutImageManifestDigest(result.stdout);
}

export async function reconcileLegacyScoutProd(
  version: string,
  pinnedDigest: string,
  dryRun: boolean,
): Promise<void> {
  if (!SCOUT_VERSION_PATTERN.test(version)) {
    throw new Error("Legacy Scout release version is not canonical");
  }
  if (!CANONICAL_DIGEST_PATTERN.test(pinnedDigest)) {
    throw new Error("Legacy Scout production digest is not canonical");
  }
  requireCreds(dryRun);
  if (dryRun) {
    console.log(`DRYRUN: would reconcile prod to legacy release ${version}`);
    return;
  }
  const tagDigest = await resolveLegacyTagDigest(version);
  if (tagDigest !== pinnedDigest) {
    throw new Error(
      `legacy Scout tag ${version} resolves to ${tagDigest}, not pinned digest ${pinnedDigest}`,
    );
  }
  const manifestContent = await readOptionalObject(
    SCOUT_RELEASES_BUCKET,
    `${version}.json`,
  );
  if (manifestContent === null) {
    throw new Error(
      `no current or legacy archive manifest exists for production release ${version}`,
    );
  }
  const manifest = parseLegacyScoutReleaseManifest(manifestContent);
  if (manifest.version !== version) {
    throw new Error(
      `legacy Scout archive manifest ${manifest.version} does not match ${version}`,
    );
  }
  const scratch = `${tmpBase()}/scout-prod-legacy-${version}-${process.pid.toString()}`;
  try {
    await run(
      [
        "aws",
        "s3",
        "sync",
        `s3://${SCOUT_RELEASES_BUCKET}/${version}/`,
        `${scratch}/site`,
        "--endpoint-url",
        SEAWEEDFS_ENDPOINT,
      ],
      { env: SEAWEEDFS_AWS_ENV },
    );
    await assertStaticSiteComplete(`${scratch}/site`, "legacy-reconcile-prod");
    const markerContent = await readOptionalObject(PROD_BUCKET, MARKER_KEY);
    const mismatch = await firstS3ObjectMismatch({
      sourceDir: `${scratch}/site`,
      bucket: PROD_BUCKET,
      paths: RELEASE_ENTRYPOINTS,
      scratchDir: scratch,
      endpoint: SEAWEEDFS_ENDPOINT,
      env: SEAWEEDFS_AWS_ENV,
    });
    if (mismatch === undefined && markerContent?.trim() === version) {
      return;
    }
    await s3SyncStaticSite({
      source: `${scratch}/site`,
      bucket: PROD_BUCKET,
      endpoint: SEAWEEDFS_ENDPOINT,
      immutablePrefixes: IMMUTABLE_PREFIXES,
      extraExcludes: [MARKER_KEY],
      forceMutableUpload: true,
      cwd: root(),
      env: SEAWEEDFS_AWS_ENV,
      dryRun: false,
      haveCreds: true,
    });
    await assertS3ObjectsMatchSource({
      sourceDir: `${scratch}/site`,
      bucket: PROD_BUCKET,
      paths: RELEASE_ENTRYPOINTS,
      scratchDir: scratch,
      endpoint: SEAWEEDFS_ENDPOINT,
      env: SEAWEEDFS_AWS_ENV,
    });
    await writeMarker(version);
    const writtenMarker = await readOptionalObject(PROD_BUCKET, MARKER_KEY);
    if (writtenMarker?.trim() !== version) {
      throw new Error(
        "production release marker does not match legacy deployed state",
      );
    }
  } finally {
    await Bun.$`rm -rf ${scratch}`.quiet();
  }
}
