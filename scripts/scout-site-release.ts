#!/usr/bin/env bun
/**
 * Versioned, stage-pinned deploys for the scout-for-lol static site
 * (Astro marketing site + Vite SPA, built into one bucket dir by
 * packages/scout-for-lol/scripts/build-bucket.ts).
 *
 * Why this exists: the backend image is pinned per stage in
 * packages/homelab/src/cdk8s/src/versions.ts, but the old catalog deploy
 * (scripts/deploy-site.ts) pushed latest-main site content to BOTH stage
 * buckets on every build — so prod served an SPA compiled against a newer
 * tRPC contract than the pinned prod backend (the `filters` crash). These
 * subcommands keep each stage's site content in lockstep with its backend:
 *
 * - archive: build the prod flavor, archive it byte-for-byte, then write its
 *   manifest last; its manifest certifies a complete archive.
 * - deploy-beta: build and continuously sync the beta flavor, then write its
 *   release marker.
 * - reconcile-prod: sync the archive selected by the production image pin,
 *   verify the mutable entrypoints, then write its release marker.
 * - tag-release: mint the paired backend+site GHCR tag only after the archive
 *   manifest exists, making every Renovate-discoverable tag promotable.
 *
 * Promotion = merging the Renovate PR that bumps the prod image pin (each
 * minted 2.0.0-<n> tag is an atomic backend+site pair — see tag-release).
 * Rollback = git-revert the promotion commit, or hand-pin any older minted
 * tag; the next main build reconciles the bucket back.
 *
 * All subcommands accept --dry-run (deploy-site.ts semantics: print the plan;
 * run `aws --dryrun` only when credentials are present).
 */

import {
  run,
  runAllowExit,
  requireEnv,
  optionalEnv,
  tmpBase,
} from "./lib/run.ts";
import {
  assertS3ObjectsMatchSource,
  assertStaticSiteComplete,
  firstS3ObjectMismatch,
  readS3Marker,
  s3SyncStaticSite,
  SEAWEEDFS_ENDPOINT,
  SEAWEEDFS_AWS_ENV,
} from "./lib/s3-static-site.ts";
import { imageLayers } from "./lib/container-registry.ts";
import versions from "@homelab/cdk8s/src/versions.ts";

const RELEASES_BUCKET = "scout-site-releases";
const PROD_BUCKET = "scout-frontend";
const BETA_BUCKET = "scout-frontend-beta";
/**
 * Version marker object at the bucket root. Written only after a successful
 * sync; excluded from the deploy's `--delete` pass. Served by Caddy at
 * `/.release-version`, which doubles as a public verification endpoint.
 */
const MARKER_KEY = ".release-version";
const SITE_PACKAGE_DIR = "packages/scout-for-lol";
const DIST_DIR = "packages/scout-for-lol/packages/frontend/dist";
// Astro marketing (`_astro/`) + the Vite SPA bundle (`app/assets/`) are
// content-hashed → immutable; everything else is no-cache + --delete.
const IMMUTABLE_PREFIXES = ["_astro/", "app/assets/"];
const RELEASE_ENTRYPOINTS = ["index.html", "app/index.html"] as const;
// Analytics pixels intentionally omitted for beta — beta traffic must not
// inflate prod Pinterest/Reddit conversion data.
const BETA_PIXEL_PLACEHOLDERS: Readonly<Record<string, string>> = {
  PUBLIC_PINTEREST_TAG_ID: "beta-placeholder-pinterest-tag-id",
  PUBLIC_REDDIT_PIXEL_ID: "beta-placeholder-reddit-pixel-id",
};
const PROD_PIXEL_ENV_VARS = [
  "PUBLIC_PINTEREST_TAG_ID",
  "PUBLIC_REDDIT_PIXEL_ID",
];
// Plausible site domain the app SPA reports product-analytics events under
// (lib/analytics.ts). Per-flavor so beta traffic lands in its own Plausible
// site and never mixes with prod. A public domain string, not a secret.
const PLAUSIBLE_DOMAIN_BY_FLAVOR: Readonly<Record<"prod" | "beta", string>> = {
  prod: "scout-for-lol.com",
  beta: "beta.scout-for-lol.com",
};
const VERSION_PATTERN = /^2\.0\.0-\d+$/;

/** Repo root = two levels up from this file (scripts/scout-site-release.ts). */
function repoRoot(): string {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
}

/** Commit this build is producing artifacts for. */
async function resolveGitSha(): Promise<string> {
  const fromCi = optionalEnv("BUILDKITE_COMMIT");
  if (fromCi !== null) {
    return fromCi;
  }
  const revParse = await run(["git", "rev-parse", "HEAD"], { capture: true });
  return revParse.stdout.trim();
}

/**
 * Hash of the tRPC contract sources (same script the images step bakes into
 * the backend as ENV CONTRACT_HASH). Stamped into the SPA bundle so the app
 * can compare its contract against the running backend's at runtime.
 */
async function contractHash(): Promise<string> {
  const result = await run(
    ["bun", "--no-install", "packages/scout-for-lol/scripts/contract-hash.ts"],
    { cwd: repoRoot(), capture: true },
  );
  return result.stdout.trim();
}

function haveCreds(): boolean {
  return (
    optionalEnv("AWS_ACCESS_KEY_ID") !== null &&
    optionalEnv("AWS_SECRET_ACCESS_KEY") !== null
  );
}

function requireCredsForLiveRun(dryRun: boolean): void {
  if (!dryRun && !haveCreds()) {
    // Fail fast with the exact missing var.
    requireEnv("AWS_ACCESS_KEY_ID");
    requireEnv("AWS_SECRET_ACCESS_KEY");
  }
}

/**
 * Build the site bucket dir in the requested stage flavor. The two flavors
 * differ only in analytics env vars — the marketing pixel IDs and the app-SPA
 * Plausible domain (prod vs beta site). Both stamp the Sentry release env vars
 * (`VITE_SENTRY_RELEASE` for the SPA, `PUBLIC_SENTRY_RELEASE` for the marketing
 * site) with the build version so Bugsink events are attributable to a deploy.
 */
async function buildSite(
  flavor: "prod" | "beta",
  version: string,
  dryRun: boolean,
): Promise<void> {
  const gitSha = await resolveGitSha();
  const buildEnv: Record<string, string> = {
    VITE_SENTRY_RELEASE: version,
    PUBLIC_SENTRY_RELEASE: version,
    // Build identity shown in the SPA footer / marketing footer, plus the
    // contract hash the SPA compares against GET /api/version at runtime.
    VITE_APP_VERSION: version,
    VITE_GIT_SHA: gitSha,
    VITE_CONTRACT_HASH: await contractHash(),
    PUBLIC_APP_VERSION: version,
    PUBLIC_GIT_SHA: gitSha,
    // Enable app-SPA product analytics per flavor (prod vs beta Plausible site).
    VITE_PLAUSIBLE_DOMAIN: PLAUSIBLE_DOMAIN_BY_FLAVOR[flavor],
  };
  if (flavor === "prod") {
    for (const name of PROD_PIXEL_ENV_VARS) {
      buildEnv[name] = dryRun
        ? (optionalEnv(name) ?? `<${name} from env>`)
        : requireEnv(name);
    }
  } else {
    Object.assign(buildEnv, BETA_PIXEL_PLACEHOLDERS);
  }

  console.log(`+++ build (${flavor} flavor, release ${version})`);
  if (dryRun) {
    console.log(
      `DRYRUN: would run \`bun --no-install run scripts/build-bucket.ts\` in ${SITE_PACKAGE_DIR} ` +
        `with env ${Object.keys(buildEnv).join(", ")}`,
    );
    return;
  }
  await run(["bun", "--no-install", "run", "scripts/build-bucket.ts"], {
    cwd: `${repoRoot()}/${SITE_PACKAGE_DIR}`,
    env: buildEnv,
  });
}

function parseVersionArg(args: string[]): string {
  const index = args.indexOf("--version");
  const version = index === -1 ? undefined : args[index + 1];
  if (version === undefined) {
    throw new Error("--version 2.0.0-<build> is required for this subcommand");
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(
      `--version must match ${VERSION_PATTERN.toString()}, got: ${version}`,
    );
  }
  return version;
}

/** Write the bucket's `.release-version` marker (after a successful sync). */
async function writeMarker(bucket: string, version: string): Promise<void> {
  const markerFile = `${tmpBase()}/scout-site-marker-${process.pid.toString()}`;
  await Bun.write(markerFile, `${version}\n`);
  await run(
    [
      "aws",
      "s3",
      "cp",
      markerFile,
      `s3://${bucket}/${MARKER_KEY}`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--cache-control",
      "no-cache",
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  await Bun.file(markerFile).delete();
}

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

async function archive(version: string, dryRun: boolean): Promise<void> {
  console.log(`--- archive ${version} -> s3://${RELEASES_BUCKET}/${version}/`);
  requireCredsForLiveRun(dryRun);
  await buildSite("prod", version, dryRun);

  const dist = `${repoRoot()}/${DIST_DIR}`;
  const dest = `s3://${RELEASES_BUCKET}/${version}/`;

  if (dryRun) {
    console.log(
      `DRYRUN: would sync ${DIST_DIR} -> ${dest} (--delete, plain archive copy), ` +
        `then upload manifest ${version}.json last`,
    );
    return;
  }

  await assertStaticSiteComplete(dist, "archive");
  // Plain archive copy — exact mirror of the dist (Cache-Control is applied
  // at prod-deploy time by reconcile-prod, not baked into the archive).
  await run(
    [
      "aws",
      "s3",
      "sync",
      dist,
      dest,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--delete",
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );

  // Manifest LAST: its existence certifies the archive above is complete.
  const gitSha = await resolveGitSha();
  const manifestFile = `${tmpBase()}/scout-site-manifest-${process.pid.toString()}.json`;
  await Bun.write(
    manifestFile,
    `${JSON.stringify({ version, gitSha, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
  await run(
    [
      "aws",
      "s3",
      "cp",
      manifestFile,
      `s3://${RELEASES_BUCKET}/${version}.json`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  await Bun.file(manifestFile).delete();
  console.log(`--- archived ${version}`);
}

// ---------------------------------------------------------------------------
// deploy-beta
// ---------------------------------------------------------------------------

async function deployBeta(version: string, dryRun: boolean): Promise<void> {
  console.log(`--- deploy-beta ${version} -> s3://${BETA_BUCKET}/`);
  requireCredsForLiveRun(dryRun);
  await buildSite("beta", version, dryRun);

  const dist = `${repoRoot()}/${DIST_DIR}`;
  if (!dryRun) {
    await assertStaticSiteComplete(dist, "deploy-beta");
  }
  await s3SyncStaticSite({
    source: dist,
    bucket: BETA_BUCKET,
    endpoint: SEAWEEDFS_ENDPOINT,
    immutablePrefixes: IMMUTABLE_PREFIXES,
    extraExcludes: [MARKER_KEY],
    cwd: repoRoot(),
    env: SEAWEEDFS_AWS_ENV,
    dryRun,
    haveCreds: haveCreds(),
  });
  if (dryRun) {
    console.log(`DRYRUN: would write marker ${MARKER_KEY} = ${version}`);
    return;
  }
  await writeMarker(BETA_BUCKET, version);
  console.log(`--- beta serving ${version}`);
}

// ---------------------------------------------------------------------------
// reconcile-prod
// ---------------------------------------------------------------------------

async function reconcileProd(dryRun: boolean): Promise<void> {
  // The prod site version is the tag portion of the Renovate-managed prod
  // image pin: minted tags are atomic backend+site pairs, so one pin moves
  // both stages' halves together.
  const imagePin = versions["shepherdjerred/scout-for-lol/prod"];
  const pin = imagePin.split("@")[0];
  console.log(`--- reconcile-prod (pin: ${pin ?? "<empty>"})`);
  if (pin === undefined || !VERSION_PATTERN.test(pin)) {
    throw new Error(
      `shepherdjerred/scout-for-lol/prod pin "${imagePin}" has no tag matching ${VERSION_PATTERN.toString()} — ` +
        `pin a minted release tag (tag-release) so the site version can be derived`,
    );
  }
  const dryRunPlan =
    `DRYRUN: would force-copy mutable files and sync immutable files from ` +
    `s3://${RELEASES_BUCKET}/${pin}/ to s3://${PROD_BUCKET}/, byte-verify both entrypoints, then write the marker`;
  requireCredsForLiveRun(dryRun);
  if (dryRun && !haveCreds()) {
    console.log(dryRunPlan);
    return;
  }
  const marker = await readS3Marker({
    bucket: PROD_BUCKET,
    key: MARKER_KEY,
    endpoint: SEAWEEDFS_ENDPOINT,
    env: SEAWEEDFS_AWS_ENV,
  });
  if (dryRun) {
    console.log(dryRunPlan);
    return;
  }
  const scratch = `${tmpBase()}/scout-site-release-${pin}-${process.pid.toString()}`;
  // Create the scratch workspace explicitly so the downloads below write into a
  // directory that is guaranteed to exist, rather than depending on the aws CLI
  // to materialise intermediate parents on the first `cp`.
  await Bun.$`mkdir -p ${scratch}`.quiet();
  // Manifest first: it was uploaded last at archive time, so its presence
  // certifies the versioned prefix is complete. A missing manifest means the
  // archive never finished, never ran, or expired past retention — fail
  // loudly rather than half-syncing prod.
  const manifest = await runAllowExit(
    [
      "aws",
      "s3",
      "cp",
      `s3://${RELEASES_BUCKET}/${pin}.json`,
      `${scratch}/manifest.json`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  if (manifest.exitCode !== 0) {
    throw new Error(
      `archive manifest s3://${RELEASES_BUCKET}/${pin}.json is missing — ` +
        `the pinned version was never (completely) archived or has expired. ` +
        `Promote a version that exists in s3://${RELEASES_BUCKET}/.`,
    );
  }
  await run(
    [
      "aws",
      "s3",
      "sync",
      `s3://${RELEASES_BUCKET}/${pin}/`,
      `${scratch}/site`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  await assertStaticSiteComplete(`${scratch}/site`, "reconcile-prod");
  const entrypointMismatch = await firstS3ObjectMismatch({
    sourceDir: `${scratch}/site`,
    bucket: PROD_BUCKET,
    paths: RELEASE_ENTRYPOINTS,
    scratchDir: scratch,
    endpoint: SEAWEEDFS_ENDPOINT,
    env: SEAWEEDFS_AWS_ENV,
  });
  if (marker === pin && entrypointMismatch === undefined) {
    await Bun.$`rm -rf ${scratch}`.quiet();
    console.log(`prod already serves ${pin} — entrypoints verified, no-op`);
    return;
  }
  if (marker === pin) {
    console.log(
      `prod marker is ${pin}, but ${entrypointMismatch ?? "an entrypoint"} is stale — repairing`,
    );
  } else {
    console.log(
      `prod serves ${marker ?? "<unknown>"}, pin is ${pin} — syncing`,
    );
  }
  await s3SyncStaticSite({
    source: `${scratch}/site`,
    bucket: PROD_BUCKET,
    endpoint: SEAWEEDFS_ENDPOINT,
    immutablePrefixes: IMMUTABLE_PREFIXES,
    extraExcludes: [MARKER_KEY],
    forceMutableUpload: true,
    cwd: repoRoot(),
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
  // Marker last: a crash anywhere above leaves the old marker in place, so
  // the next build's reconcile retries — the flow converges.
  await writeMarker(PROD_BUCKET, pin);
  await Bun.$`rm -rf ${scratch}`.quiet();
  console.log(`--- prod now serves ${pin}`);
}

// ---------------------------------------------------------------------------
// tag-release
// ---------------------------------------------------------------------------

const IMAGE_REPO = "ghcr.io/shepherdjerred/scout-for-lol";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function parseDigestArg(args: string[]): string | null {
  const index = args.indexOf("--digest");
  if (index === -1) {
    return null;
  }
  const digest = args[index + 1];
  if (digest === undefined || !DIGEST_PATTERN.test(digest)) {
    throw new Error(
      `--digest must match ${DIGEST_PATTERN.toString()}, got: ${digest ?? "<missing>"}`,
    );
  }
  return digest;
}

/**
 * The archived artifact for a version must exist before its tag is minted
 * (the manifest is the completeness certificate — same gate reconcile-prod
 * applies before syncing).
 */
async function assertArchived(version: string): Promise<void> {
  const head = await runAllowExit(
    [
      "aws",
      "s3api",
      "head-object",
      "--bucket",
      RELEASES_BUCKET,
      "--key",
      `${version}.json`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV, capture: true },
  );
  if (head.exitCode !== 0) {
    throw new Error(
      `no archive manifest for ${version} in s3://${RELEASES_BUCKET}/ — refusing to mint ` +
        `${IMAGE_REPO}:${version}: only archived site versions may become promotable tags.`,
    );
  }
}

/**
 * Mint `ghcr.io/shepherdjerred/scout-for-lol:<version>` pointing at the paired
 * backend digest. The tag is the atomic release pair the Renovate-managed
 * `shepherdjerred/scout-for-lol/prod` pin promotes: tag name = archived site
 * version, tag target = the backend image content beta serves that site
 * against. Requires a prior `docker login ghcr.io` (the pipeline step does it).
 */
async function tagRelease(
  version: string,
  digestArg: string | null,
  dryRun: boolean,
): Promise<void> {
  console.log(`--- tag-release ${version} (${IMAGE_REPO})`);
  if (dryRun) {
    console.log(
      `DRYRUN: would assert s3://${RELEASES_BUCKET}/${version}.json exists, resolve the ` +
        `paired backend digest (${digestArg ?? "committed beta pin + content-currency guard"}), ` +
        `then \`docker buildx imagetools create --tag ${IMAGE_REPO}:${version} ${IMAGE_REPO}@<digest>\``,
    );
    return;
  }
  requireCredsForLiveRun(dryRun);
  await assertArchived(version);

  let digest = digestArg;
  if (digest === null) {
    const betaPin = versions["shepherdjerred/scout-for-lol/beta"];
    const pinnedDigest = betaPin.split("@")[1];
    if (pinnedDigest === undefined || !DIGEST_PATTERN.test(pinnedDigest)) {
      throw new Error(
        `beta pin "${betaPin}" carries no @sha256 digest to pair with ${version}`,
      );
    }
    // Content-currency guard: the committed beta pin lags one build behind
    // whenever the images step pushed new scout content this cycle (the
    // auto-merge version commit-back PR hasn't landed yet). Pairing the NEW
    // site with the OLD backend digest is the exact tRPC skew the release
    // pair exists to prevent, so compare rootfs layers of the pin vs :latest
    // and skip minting when they differ — the commit-back merge fires the
    // site lane again and mints a correctly paired release next build.
    const pinnedLayers = await imageLayers(`${IMAGE_REPO}@${pinnedDigest}`);
    const latestLayers = await imageLayers(`${IMAGE_REPO}:latest`);
    if (pinnedLayers !== latestLayers) {
      console.log(
        `beta pin ${pinnedDigest} is content-stale vs ${IMAGE_REPO}:latest (version ` +
          `commit-back pending) — not minting ${version}; the commit-back merge build ` +
          `will archive and mint the correctly paired release.`,
      );
      return;
    }
    digest = pinnedDigest;
  }

  await run([
    "docker",
    "buildx",
    "imagetools",
    "create",
    "--tag",
    `${IMAGE_REPO}:${version}`,
    `${IMAGE_REPO}@${digest}`,
  ]);
  console.log(`--- minted ${IMAGE_REPO}:${version} -> ${digest}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage:\n" +
      "  bun scripts/scout-site-release.ts archive --version 2.0.0-<build> [--dry-run]\n" +
      "  bun scripts/scout-site-release.ts deploy-beta --version 2.0.0-<build> [--dry-run]\n" +
      "  bun scripts/scout-site-release.ts reconcile-prod [--dry-run]\n" +
      "  bun scripts/scout-site-release.ts tag-release --version 2.0.0-<build> [--digest sha256:<hex>] [--dry-run]\n\n" +
      "Env: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (SeaweedFS); archive also\n" +
      "needs PUBLIC_PINTEREST_TAG_ID/PUBLIC_REDDIT_PIXEL_ID (prod flavor);\n" +
      "tag-release needs a prior `docker login ghcr.io`.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
  }
  const dryRun = args.includes("--dry-run");
  const subcommand = args[0];
  if (subcommand === undefined) {
    usage();
  }
  switch (subcommand) {
    case "archive":
      await archive(parseVersionArg(args), dryRun);
      break;
    case "deploy-beta":
      await deployBeta(parseVersionArg(args), dryRun);
      break;
    case "reconcile-prod":
      await reconcileProd(dryRun);
      break;
    case "tag-release":
      await tagRelease(parseVersionArg(args), parseDigestArg(args), dryRun);
      break;
    default:
      usage();
  }
}

await main();
