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
 *   archive --version 2.0.0-<n>      Build the PROD-flavored site and archive
 *                                    it byte-for-byte to
 *                                    s3://scout-site-releases/<version>/, then
 *                                    upload the sibling <version>.json
 *                                    manifest LAST (its existence certifies a
 *                                    complete archive).
 *   deploy-beta --version 2.0.0-<n>  Build the BETA-flavored site, sync it to
 *                                    the live beta bucket (beta stays
 *                                    continuous — it is the canary), then
 *                                    write the `.release-version` marker.
 *   reconcile-prod                   Compare the `scout-for-lol-site/prod` pin
 *                                    in versions.ts against the prod bucket's
 *                                    `.release-version` marker; on mismatch,
 *                                    sync the pinned archived artifact to the
 *                                    prod bucket (no rebuild — byte-identical
 *                                    to what beta validated). No-op when the
 *                                    marker matches or the pin is the
 *                                    "unpromoted" rollout sentinel.
 *
 * Promotion = scripts/promote-scout.ts (one PR moving the site pin AND the
 * backend image pin together). Rollback = git-revert the promotion commit; the
 * next main build reconciles the bucket back.
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
  s3SyncStaticSite,
  SEAWEEDFS_ENDPOINT,
  SEAWEEDFS_AWS_ENV,
} from "./lib/s3-static-site.ts";
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
const VERSION_PATTERN = /^2\.0\.0-\d+$/;
/** Pre-first-promotion sentinel value of the site pin (see versions.ts). */
const UNPROMOTED_SENTINEL = "unpromoted";

/** Repo root = two levels up from this file (scripts/scout-site-release.ts). */
function repoRoot(): string {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
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
 * differ ONLY in analytics pixel env vars; both stamp the Sentry release env
 * vars (`VITE_SENTRY_RELEASE` for the SPA, `PUBLIC_SENTRY_RELEASE` for the
 * marketing site) with the build version so Bugsink events are attributable
 * to a deploy.
 */
async function buildSite(
  flavor: "prod" | "beta",
  version: string,
  dryRun: boolean,
): Promise<void> {
  const buildEnv: Record<string, string> = {
    VITE_SENTRY_RELEASE: version,
    PUBLIC_SENTRY_RELEASE: version,
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
      `DRYRUN: would run \`bun run scripts/build-bucket.ts\` in ${SITE_PACKAGE_DIR} ` +
        `with env ${Object.keys(buildEnv).join(", ")}`,
    );
    return;
  }
  await run(["bun", "run", "scripts/build-bucket.ts"], {
    cwd: `${repoRoot()}/${SITE_PACKAGE_DIR}`,
    env: buildEnv,
  });
}

/**
 * Refuse to ship a half-built bucket dir: both site halves' entry points must
 * exist (marketing `index.html`, SPA `app/index.html`). A missing half with
 * `--delete` would wipe that half from the live bucket.
 */
async function assertSiteComplete(dir: string, label: string): Promise<void> {
  for (const rel of ["index.html", "app/index.html"]) {
    if (!(await Bun.file(`${dir}/${rel}`).exists())) {
      throw new Error(`${label}: ${dir}/${rel} is missing — refusing to sync`);
    }
  }
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

/**
 * Read a bucket's `.release-version` marker. Returns null when the marker is
 * missing or unreadable — both mean "state unknown", and the caller's answer
 * to unknown state is a (idempotent) full sync that rewrites the marker, so
 * transient read failures self-heal rather than abort. A genuine outage will
 * fail the subsequent sync loudly anyway.
 */
async function readMarker(bucket: string): Promise<string | null> {
  const result = await runAllowExit(
    [
      "aws",
      "s3",
      "cp",
      `s3://${bucket}/${MARKER_KEY}`,
      "-",
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV, capture: true },
  );
  if (result.exitCode !== 0) {
    console.log(
      `marker s3://${bucket}/${MARKER_KEY} missing or unreadable (exit ${result.exitCode.toString()}) — treating as out of date`,
    );
    return null;
  }
  return result.stdout.trim();
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

  await assertSiteComplete(dist, "archive");
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
  let gitSha = optionalEnv("BUILDKITE_COMMIT");
  if (gitSha === null) {
    const revParse = await run(["git", "rev-parse", "HEAD"], { capture: true });
    gitSha = revParse.stdout.trim();
  }
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
    await assertSiteComplete(dist, "deploy-beta");
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
  const pin = versions["scout-for-lol-site/prod"];
  console.log(`--- reconcile-prod (pin: ${pin})`);

  if (pin === UNPROMOTED_SENTINEL) {
    console.log(
      "site pin is the pre-first-promotion sentinel — leaving the prod bucket untouched. " +
        "Run scripts/promote-scout.ts to promote a beta-validated version.",
    );
    return;
  }
  if (!VERSION_PATTERN.test(pin)) {
    throw new Error(
      `scout-for-lol-site/prod pin ${pin} matches neither ${VERSION_PATTERN.toString()} nor "${UNPROMOTED_SENTINEL}"`,
    );
  }
  requireCredsForLiveRun(dryRun);
  if (dryRun && !haveCreds()) {
    console.log(
      `DRYRUN: would compare the prod marker against ${pin} and, on mismatch, ` +
        `sync s3://${RELEASES_BUCKET}/${pin}/ -> s3://${PROD_BUCKET}/ (two-pass) + write the marker`,
    );
    return;
  }

  const marker = await readMarker(PROD_BUCKET);
  if (marker === pin) {
    console.log(`prod already serves ${pin} — no-op`);
    return;
  }
  console.log(`prod serves ${marker ?? "<unknown>"}, pin is ${pin} — syncing`);
  if (dryRun) {
    console.log(
      `DRYRUN: would sync s3://${RELEASES_BUCKET}/${pin}/ -> s3://${PROD_BUCKET}/ (two-pass) + write the marker`,
    );
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
  await assertSiteComplete(`${scratch}/site`, "reconcile-prod");

  await s3SyncStaticSite({
    source: `${scratch}/site`,
    bucket: PROD_BUCKET,
    endpoint: SEAWEEDFS_ENDPOINT,
    immutablePrefixes: IMMUTABLE_PREFIXES,
    extraExcludes: [MARKER_KEY],
    cwd: repoRoot(),
    env: SEAWEEDFS_AWS_ENV,
    dryRun: false,
    haveCreds: true,
  });
  // Marker last: a crash anywhere above leaves the old marker in place, so
  // the next build's reconcile retries — the flow converges.
  await writeMarker(PROD_BUCKET, pin);
  await Bun.$`rm -rf ${scratch}`.quiet();
  console.log(`--- prod now serves ${pin}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage:\n" +
      "  bun scripts/scout-site-release.ts archive --version 2.0.0-<build> [--dry-run]\n" +
      "  bun scripts/scout-site-release.ts deploy-beta --version 2.0.0-<build> [--dry-run]\n" +
      "  bun scripts/scout-site-release.ts reconcile-prod [--dry-run]\n\n" +
      "Env: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (SeaweedFS); archive also\n" +
      "needs PUBLIC_PINTEREST_TAG_ID/PUBLIC_REDDIT_PIXEL_ID (prod flavor).",
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
    default:
      usage();
  }
}

await main();
