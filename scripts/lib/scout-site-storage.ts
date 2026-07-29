import { run, runAllowExit, optionalEnv, requireEnv, tmpBase } from "./run.ts";
import {
  assertS3ObjectsMatchSource,
  assertStaticSiteComplete,
  firstS3ObjectMismatch,
  isMissingS3Object,
  s3SyncStaticSite,
  SEAWEEDFS_ENDPOINT,
  SEAWEEDFS_AWS_ENV,
} from "./s3-static-site.ts";
import {
  archiveRecord,
  assertArchiveRecordMatchesState,
  CANONICAL_DIGEST_PATTERN,
  inputRecordMatchesState,
  parseScoutReleaseState,
  SCOUT_VERSION_PATTERN,
  siteReleaseIdentity,
  type ScoutReleaseState,
} from "./scout-release-state.ts";

export const SCOUT_RELEASES_BUCKET = "scout-site-releases";
export const SCOUT_RELEASE_WORK_DIR = ".scout-release";
const PROD_BUCKET = "scout-frontend";
const BETA_BUCKET = "scout-frontend-beta";
const MARKER_KEY = ".release-version";
const IMMUTABLE_PREFIXES = ["_astro/", "app/assets/"];
const RELEASE_ENTRYPOINTS = ["index.html", "app/index.html"] as const;

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

async function writeMarker(bucket: string, identity: string): Promise<void> {
  const file = `${tmpBase()}/scout-site-marker-${process.pid.toString()}`;
  try {
    await Bun.write(file, `${identity}\n`);
    await run(
      [
        "aws",
        "s3",
        "cp",
        file,
        `s3://${bucket}/${MARKER_KEY}`,
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

export async function hashSiteArchive(directory: string): Promise<string> {
  const paths: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    paths.push(path);
  }
  paths.sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of paths) {
    hasher.update(`${path}\0`);
    hasher.update(await Bun.file(`${directory}/${path}`).bytes());
  }
  return `sha256:${hasher.digest("hex")}`;
}

export function isMissingS3ObjectError(stderr: string): boolean {
  return isMissingS3Object(stderr);
}

export function isS3PreconditionFailure(stderr: string): boolean {
  return stderr.includes("PreconditionFailed") || /\b412\b/.test(stderr);
}

export function immutablePutCommand(key: string, file: string): string[] {
  return [
    "aws",
    "s3api",
    "put-object",
    "--bucket",
    SCOUT_RELEASES_BUCKET,
    "--key",
    key,
    "--body",
    file,
    "--if-none-match",
    "*",
    "--endpoint-url",
    SEAWEEDFS_ENDPOINT,
    "--no-cli-pager",
  ];
}

async function readOptionalBucketObject(
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
  if (isMissingS3ObjectError(result.stderr)) {
    return null;
  }
  throw new Error(`failed to read s3://${bucket}/${key}: ${result.stderr}`);
}

async function readOptionalObject(key: string): Promise<string | null> {
  return await readOptionalBucketObject(SCOUT_RELEASES_BUCKET, key);
}

async function putImmutableObject(key: string, content: string): Promise<void> {
  await putImmutableObjectMatching(
    key,
    content,
    (existing) => existing === content,
  );
}

async function putImmutableObjectMatching(
  key: string,
  content: string,
  matchesExisting: (existing: string) => boolean,
): Promise<void> {
  const existing = await readOptionalObject(key);
  if (existing !== null) {
    if (!matchesExisting(existing)) {
      throw new Error(`immutable Scout release object ${key} already differs`);
    }
    return;
  }
  const file = `${tmpBase()}/scout-immutable-${crypto.randomUUID()}.json`;
  try {
    await Bun.write(file, content);
    const result = await runAllowExit(immutablePutCommand(key, file), {
      env: SEAWEEDFS_AWS_ENV,
    });
    if (result.exitCode === 0) {
      return;
    }
    if (!isS3PreconditionFailure(result.stderr)) {
      throw new Error(
        `failed to create immutable Scout release object ${key}: ${result.stderr}`,
      );
    }
    const raced = await readOptionalObject(key);
    if (raced === null || !matchesExisting(raced)) {
      throw new Error(
        `immutable Scout release object ${key} raced and differs`,
      );
    }
  } finally {
    await Bun.file(file).delete();
  }
}

export async function readScoutStateByInput(
  releaseInputDigest: string,
): Promise<ScoutReleaseState | null> {
  if (!CANONICAL_DIGEST_PATTERN.test(releaseInputDigest)) {
    throw new Error("Scout release input digest is not canonical");
  }
  const identity = releaseInputDigest.slice("sha256:".length);
  const content = await readOptionalObject(`inputs/${identity}.json`);
  if (content === null) {
    return null;
  }
  const state = parseScoutReleaseState(content);
  if (state.releaseInputDigest !== releaseInputDigest) {
    throw new Error("Scout release input index points to a different identity");
  }
  return state;
}

export async function readScoutStateByVersion(
  version: string,
): Promise<ScoutReleaseState | null> {
  if (!SCOUT_VERSION_PATTERN.test(version)) {
    throw new Error("Scout release version is not canonical");
  }
  const content = await readOptionalObject(`versions/${version}.json`);
  return content === null ? null : parseScoutReleaseState(content);
}

export async function assertScoutArchived(
  state: ScoutReleaseState,
  flavor: "prod" | "beta",
): Promise<void> {
  const identity = state.releaseInputDigest.slice("sha256:".length);
  const manifest = await readOptionalObject(`${identity}/${flavor}.json`);
  if (manifest === null) {
    throw new Error(
      `no immutable ${flavor} archive for ${siteReleaseIdentity(state)}`,
    );
  }
  assertArchiveRecordMatchesState(manifest, state, flavor);
}

async function downloadAndVerifyArchiveBytes(
  state: ScoutReleaseState,
  flavor: "prod" | "beta",
  destination: string,
): Promise<void> {
  const identity = state.releaseInputDigest.slice("sha256:".length);
  const expected =
    flavor === "prod" ? state.siteArchiveDigest : state.betaSiteArchiveDigest;
  await Bun.$`mkdir -p ${destination}`.quiet();
  await run(
    [
      "aws",
      "s3",
      "sync",
      `s3://${SCOUT_RELEASES_BUCKET}/${identity}/${flavor}/`,
      destination,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--delete",
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  await assertStaticSiteComplete(destination, `verify-${flavor}-archive`);
  const actual = await hashSiteArchive(destination);
  if (actual !== expected) {
    throw new Error(
      `remote ${flavor} archive digest mismatch: expected ${expected}, got ${actual}`,
    );
  }
}

export async function assertScoutArchiveBytes(
  state: ScoutReleaseState,
  flavor: "prod" | "beta",
): Promise<void> {
  const identity = state.releaseInputDigest.slice("sha256:".length);
  const scratch = `${tmpBase()}/scout-archive-check-${identity}-${flavor}-${crypto.randomUUID()}`;
  try {
    await assertScoutArchived(state, flavor);
    await downloadAndVerifyArchiveBytes(state, flavor, scratch);
  } finally {
    await Bun.$`rm -rf ${scratch}`.quiet();
  }
}

async function archiveFlavor(
  flavor: "prod" | "beta",
  state: ScoutReleaseState,
  dryRun: boolean,
): Promise<void> {
  const expected =
    flavor === "prod" ? state.siteArchiveDigest : state.betaSiteArchiveDigest;
  const identity = state.releaseInputDigest.slice("sha256:".length);
  const prefix = `${identity}/${flavor}`;
  const source = `${root()}/${SCOUT_RELEASE_WORK_DIR}/${flavor}`;
  if (dryRun) {
    console.log(
      `DRYRUN: would immutably archive ${flavor} at s3://${SCOUT_RELEASES_BUCKET}/${prefix}/`,
    );
    return;
  }
  const record = archiveRecord(state, flavor);
  const existing = await readOptionalObject(`${prefix}.json`);
  if (existing !== null) {
    assertArchiveRecordMatchesState(existing, state, flavor);
    return;
  }
  await assertStaticSiteComplete(source, `archive-${flavor}`);
  const actual = await hashSiteArchive(source);
  if (actual !== expected) {
    throw new Error(
      `${flavor} site archive digest mismatch: expected ${expected}, got ${actual}`,
    );
  }
  await run(
    [
      "aws",
      "s3",
      "sync",
      source,
      `s3://${SCOUT_RELEASES_BUCKET}/${prefix}/`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--delete",
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  const verification = `${tmpBase()}/scout-archive-certify-${identity}-${flavor}-${crypto.randomUUID()}`;
  try {
    await downloadAndVerifyArchiveBytes(state, flavor, verification);
    await putImmutableObject(`${prefix}.json`, record);
  } finally {
    await Bun.$`rm -rf ${verification}`.quiet();
  }
}

export async function archiveScout(
  state: ScoutReleaseState,
  dryRun: boolean,
): Promise<void> {
  requireCreds(dryRun);
  await archiveFlavor("prod", state, dryRun);
  await archiveFlavor("beta", state, dryRun);
  if (dryRun) {
    return;
  }
  const record = `${JSON.stringify(state)}\n`;
  await putImmutableObject(`versions/${state.version}.json`, record);
  const identity = state.releaseInputDigest.slice("sha256:".length);
  await putImmutableObjectMatching(
    `inputs/${identity}.json`,
    record,
    (existing) => inputRecordMatchesState(existing, state),
  );
}

export async function deployScoutBeta(
  state: ScoutReleaseState,
  dryRun: boolean,
): Promise<void> {
  requireCreds(dryRun);
  const identity = state.releaseInputDigest.slice("sha256:".length);
  if (dryRun) {
    console.log(`DRYRUN: would deploy immutable beta archive ${identity}/beta`);
    return;
  }
  const desired = siteReleaseIdentity(state);
  const currentMarker = await readOptionalBucketObject(BETA_BUCKET, MARKER_KEY);
  const scratch = `${tmpBase()}/scout-beta-${identity}-${process.pid.toString()}`;
  try {
    await assertScoutArchived(state, "beta");
    await downloadAndVerifyArchiveBytes(state, "beta", `${scratch}/site`);
    const mismatch = await firstS3ObjectMismatch({
      sourceDir: `${scratch}/site`,
      bucket: BETA_BUCKET,
      paths: RELEASE_ENTRYPOINTS,
      scratchDir: scratch,
      endpoint: SEAWEEDFS_ENDPOINT,
      env: SEAWEEDFS_AWS_ENV,
    });
    if (mismatch === undefined && currentMarker?.trim() === desired) {
      return;
    }
    await s3SyncStaticSite({
      source: `${scratch}/site`,
      bucket: BETA_BUCKET,
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
      bucket: BETA_BUCKET,
      paths: RELEASE_ENTRYPOINTS,
      scratchDir: scratch,
      endpoint: SEAWEEDFS_ENDPOINT,
      env: SEAWEEDFS_AWS_ENV,
    });
    await writeMarker(BETA_BUCKET, desired);
    const marker = await readOptionalBucketObject(BETA_BUCKET, MARKER_KEY);
    if (marker?.trim() !== desired) {
      throw new Error("beta release marker does not match deployed state");
    }
  } finally {
    await Bun.$`rm -rf ${scratch}`.quiet();
  }
}

export async function reconcileScoutProd(
  state: ScoutReleaseState,
  dryRun: boolean,
): Promise<void> {
  requireCreds(dryRun);
  const identity = state.releaseInputDigest.slice("sha256:".length);
  const desired = siteReleaseIdentity(state);
  if (dryRun) {
    console.log(`DRYRUN: would reconcile prod to ${desired}`);
    return;
  }
  const scratch = `${tmpBase()}/scout-prod-${identity}-${process.pid.toString()}`;
  try {
    await assertScoutArchived(state, "prod");
    await downloadAndVerifyArchiveBytes(state, "prod", `${scratch}/site`);
    const markerContent = await readOptionalBucketObject(
      PROD_BUCKET,
      MARKER_KEY,
    );
    const marker = markerContent?.trim();
    const mismatch = await firstS3ObjectMismatch({
      sourceDir: `${scratch}/site`,
      bucket: PROD_BUCKET,
      paths: RELEASE_ENTRYPOINTS,
      scratchDir: scratch,
      endpoint: SEAWEEDFS_ENDPOINT,
      env: SEAWEEDFS_AWS_ENV,
    });
    if (marker === desired && mismatch === undefined) {
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
    await writeMarker(PROD_BUCKET, desired);
    const writtenMarker = await readOptionalBucketObject(
      PROD_BUCKET,
      MARKER_KEY,
    );
    if (writtenMarker?.trim() !== desired) {
      throw new Error(
        "production release marker does not match deployed state",
      );
    }
  } finally {
    await Bun.$`rm -rf ${scratch}`.quiet();
  }
}
