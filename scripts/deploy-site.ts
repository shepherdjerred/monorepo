#!/usr/bin/env bun
/**
 * Build and deploy a static site to S3 (SeaweedFS) or R2 (Cloudflare).
 *
 * Ported from the old CI's `deploySiteHelper` + `s3SyncStaticSite`
 * (.dagger/src/release.ts) and the `DEPLOY_SITES` catalog (scripts/ci). Runs
 * locally as a plain Bun script; credentials come from the environment — the
 * operator is expected to wrap invocations with `op run`.
 *
 * Usage:
 *   bun scripts/deploy-site.ts <site-name> [--dry-run]
 *   bun scripts/deploy-site.ts --list
 *
 * Env (required for a real deploy, not for --dry-run without creds):
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   — S3/R2 credentials
 *   CLOUDFLARE_ACCOUNT_ID                       — only for target "r2"
 *   plus any per-site buildEnvVars (see the catalog)
 */

import { run, requireEnv, optionalEnv } from "./lib/run.ts";

// ---------------------------------------------------------------------------
// Static site deploy catalog (translated verbatim from DEPLOY_SITES)
// ---------------------------------------------------------------------------

type DeploySiteBase = {
  bucket: string;
  name: string;
  url: string;
  /** Package dir the buildCmd runs in (relative to repo root). */
  buildDir: string;
  buildCmd: string;
  /** Directory synced to the bucket (relative to repo root). */
  distDir: string;
  /** "s3" (SeaweedFS) or "r2" (Cloudflare). */
  target: "s3" | "r2";
  /**
   * Bucket-key prefixes (relative to `distDir`, trailing slash) holding
   * content-hashed/fingerprinted assets. The deploy syncs these with a 1-year
   * `immutable` Cache-Control and never `--delete`s them (a SeaweedFS lifecycle
   * rule prunes old hashes by age); everything else is synced `no-cache` +
   * `--delete`. Defaults to `["_astro/"]` (Astro's hashed output dir). Set `[]`
   * for sites with no fingerprinted assets, or a bundler-specific dir (Vite's
   * `assets/`, the scout SPA's `app/assets/`).
   */
  immutablePrefixes: string[];
};

type DeploySiteBuildEnv =
  | {
      /** Build env vars sourced from the process environment (secrets). */
      buildEnvVars?: string[];
      buildEnvPlaceholders?: never;
    }
  | {
      buildEnvVars?: never;
      /** Static placeholder values injected as build env (beta stages). */
      buildEnvPlaceholders?: Readonly<Record<string, string>>;
    };

type DeploySite = DeploySiteBase & DeploySiteBuildEnv;

// Every site is served through caddy-s3-proxy in front of SeaweedFS, so the
// endpoint is the SeaweedFS S3 gateway for target "s3". No site currently uses
// "r2", but the target is kept so the endpoint logic matches the old helper.
const DEPLOY_SITES: readonly DeploySite[] = [
  {
    bucket: "sjer-red",
    name: "sjer.red",
    url: "https://sjer.red",
    buildDir: "packages/sjer.red",
    buildCmd: "bun run astro build",
    distDir: "packages/sjer.red/dist",
    target: "s3",
    // Astro's hashed output dir.
    immutablePrefixes: ["_astro/"],
  },
  {
    bucket: "resume",
    name: "resume",
    url: "https://resume.sjer.red",
    buildDir: "packages/resume",
    buildCmd: "true", // pre-built (LaTeX); deploy syncs existing files
    distDir: "packages/resume",
    target: "s3",
    immutablePrefixes: [],
  },
  {
    bucket: "webring",
    name: "webring",
    url: "https://webring.sjer.red",
    buildDir: "packages/webring",
    buildCmd: "bun run typedoc",
    distDir: "packages/webring/docs",
    target: "s3",
    immutablePrefixes: [],
  },
  {
    bucket: "cook",
    name: "cooklang-rich-preview",
    url: "https://cook.sjer.red",
    buildDir: "packages/cooklang-rich-preview",
    buildCmd: "bun run astro build",
    distDir: "packages/cooklang-rich-preview/dist",
    target: "s3",
    immutablePrefixes: ["_astro/"],
  },
  {
    bucket: "stocks-sjer-red",
    name: "stocks-sjer-red",
    url: "https://stocks.sjer.red",
    buildDir: "packages/stocks-sjer-red",
    buildCmd: "bun run astro build",
    distDir: "packages/stocks-sjer-red/dist",
    target: "s3",
    immutablePrefixes: ["_astro/"],
  },
  {
    bucket: "scout-frontend",
    name: "scout-for-lol frontend + app (prod)",
    url: "https://scout-for-lol.com",
    buildDir: "packages/scout-for-lol",
    buildCmd: "bun run scripts/build-bucket.ts",
    distDir: "packages/scout-for-lol/packages/frontend/dist",
    target: "s3",
    buildEnvVars: ["PUBLIC_PINTEREST_TAG_ID", "PUBLIC_REDDIT_PIXEL_ID"],
    // Astro marketing (`_astro/`) + the Vite SPA bundle (`app/assets/`) are
    // content-hashed → immutable. The SPA shell `app/index.html` is in pass 2
    // (no-cache) so deploys take effect.
    immutablePrefixes: ["_astro/", "app/assets/"],
  },
  {
    bucket: "scout-frontend-beta",
    name: "scout-for-lol frontend + app (beta)",
    url: "https://beta.scout-for-lol.com",
    buildDir: "packages/scout-for-lol",
    buildCmd: "bun run scripts/build-bucket.ts",
    distDir: "packages/scout-for-lol/packages/frontend/dist",
    target: "s3",
    // Analytics pixels intentionally omitted for beta — beta traffic must
    // not inflate prod Pinterest/Reddit conversion data.
    buildEnvPlaceholders: {
      PUBLIC_PINTEREST_TAG_ID: "beta-placeholder-pinterest-tag-id",
      PUBLIC_REDDIT_PIXEL_ID: "beta-placeholder-reddit-pixel-id",
    },
    // Astro marketing (`_astro/`) + the Vite SPA bundle (`app/assets/`) are
    // content-hashed → immutable. The SPA shell `app/index.html` is in pass 2
    // (no-cache) so deploys take effect.
    immutablePrefixes: ["_astro/", "app/assets/"],
  },
  {
    bucket: "better-skill-capped",
    name: "better-skill-capped",
    url: "https://better-skill-capped.com",
    buildDir: "packages/better-skill-capped",
    buildCmd: "bun run build",
    distDir: "packages/better-skill-capped/dist",
    target: "s3",
    // Vite SPA — content-hashed bundles live under `assets/`, not `_astro/`.
    immutablePrefixes: ["assets/"],
  },
  {
    bucket: "glitter-boys-ppl",
    name: "glitter",
    url: "https://ppl.glitter-boys.com",
    buildDir: "packages/glitter",
    buildCmd: "true",
    distDir: "packages/glitter/public",
    target: "s3",
    immutablePrefixes: [],
  },
];

const SEAWEEDFS_ENDPOINT = "https://seaweedfs-s3.tailnet-1a49.ts.net";

// ---------------------------------------------------------------------------
// Repo root resolution
// ---------------------------------------------------------------------------

/** Repo root = two levels up from this file (scripts/deploy-site.ts). */
function repoRoot(): string {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Two-pass aws s3 sync (ported from s3SyncStaticSite)
// ---------------------------------------------------------------------------

/**
 * Sync `source` to `s3://bucket/`, setting `Cache-Control` as S3 object
 * metadata (caddy-s3-proxy passes it through to the browser/CDN unchanged).
 *
 * Pass 1 uploads content-hashed/fingerprinted assets — the `immutablePrefixes`
 * (e.g. `_astro/`, `app/assets/`) — with a 1-year `immutable` Cache-Control and
 * WITHOUT `--delete`, so prior builds' hashed files survive for already-loaded
 * tabs. Pass 2 uploads everything else with `Cache-Control: no-cache` and
 * `--delete`, `--exclude`ing the hashed prefixes so retained old hashed assets
 * are left in place. When `immutablePrefixes` is empty a single `no-cache` +
 * `--delete` pass is used.
 *
 * The AWS env vars mirror the old helper: SeaweedFS S3 requires s3v4 signing,
 * so the region is pinned and the checksum headers AWS CLI v2 sends by default
 * (which SeaweedFS does not understand) are suppressed.
 */
async function s3SyncStaticSite(opts: {
  source: string;
  bucket: string;
  endpoint: string;
  immutablePrefixes: string[];
  cwd: string;
  env: Record<string, string>;
  dryRun: boolean;
  haveCreds: boolean;
}): Promise<void> {
  const { source, bucket, endpoint, immutablePrefixes, cwd, env } = opts;
  const dest = `s3://${bucket}/`;

  if (opts.dryRun) {
    const plan =
      immutablePrefixes.length > 0
        ? `pass 1 [${immutablePrefixes.join(", ")}] immutable (no --delete); ` +
          `pass 2 everything else no-cache (--delete, excluding immutable prefixes)`
        : `single pass no-cache (--delete)`;
    console.log(
      `DRYRUN: would sync ${source} -> ${dest} via ${endpoint} — ${plan}`,
    );
    if (!opts.haveCreds) {
      console.log(
        "DRYRUN: AWS credentials absent; skipping the real `aws s3 sync --dryrun` call. " +
          "The plan above is what would run with creds present.",
      );
      return;
    }
    // Creds present — surface exactly what the sync would move via --dryrun.
    if (immutablePrefixes.length > 0) {
      await run(
        [
          "aws",
          "s3",
          "sync",
          source,
          dest,
          "--endpoint-url",
          endpoint,
          "--exclude",
          "*",
          ...immutablePrefixes.flatMap((p) => ["--include", `${p}*`]),
          "--cache-control",
          "public, max-age=31536000, immutable",
          "--dryrun",
        ],
        { cwd, env },
      );
    }
    await run(
      [
        "aws",
        "s3",
        "sync",
        source,
        dest,
        "--endpoint-url",
        endpoint,
        ...immutablePrefixes.flatMap((p) => ["--exclude", `${p}*`]),
        "--cache-control",
        "no-cache",
        "--delete",
        "--dryrun",
      ],
      { cwd, env },
    );
    return;
  }

  // Pass 1: immutable, fingerprinted assets — no --delete.
  if (immutablePrefixes.length > 0) {
    await run(
      [
        "aws",
        "s3",
        "sync",
        source,
        dest,
        "--endpoint-url",
        endpoint,
        "--exclude",
        "*",
        ...immutablePrefixes.flatMap((p) => ["--include", `${p}*`]),
        "--cache-control",
        "public, max-age=31536000, immutable",
      ],
      { cwd, env },
    );
  }

  // Pass 2 (or single pass): everything else, no-cache + --delete, excluding
  // the immutable prefixes so `--delete` never prunes retained hashed assets.
  await run(
    [
      "aws",
      "s3",
      "sync",
      source,
      dest,
      "--endpoint-url",
      endpoint,
      ...immutablePrefixes.flatMap((p) => ["--exclude", `${p}*`]),
      "--cache-control",
      "no-cache",
      "--delete",
    ],
    { cwd, env },
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage: bun scripts/deploy-site.ts <site-name|bucket> [--dry-run]\n" +
      "       bun scripts/deploy-site.ts --list\n\n" +
      "A site is selected by its name OR its bucket (the bucket is the stable,\n" +
      "space-free id preferred for package scripts, e.g. `scout-frontend`).\n\n" +
      "Sites:\n" +
      DEPLOY_SITES.map((s) => `  ${s.bucket}  (${s.name})`).join("\n"),
  );
  process.exit(1);
}

/**
 * Assemble the build env: secrets pulled from the process env, or static beta
 * placeholders. requireEnv fails fast if a declared secret is missing (in a
 * dry run, absent secrets become a visible `<NAME from env>` placeholder).
 */
function buildEnvFor(
  site: DeploySite,
  dryRun: boolean,
): Record<string, string> {
  const buildEnv: Record<string, string> = {};
  if (site.buildEnvVars) {
    for (const name of site.buildEnvVars) {
      buildEnv[name] = dryRun
        ? (optionalEnv(name) ?? `<${name} from env>`)
        : requireEnv(name);
    }
  }
  if (site.buildEnvPlaceholders) {
    for (const [name, value] of Object.entries(site.buildEnvPlaceholders)) {
      buildEnv[name] = value;
    }
  }
  return buildEnv;
}

/** Run the site's build (skipping the no-op "true" sentinel for pre-built sites). */
async function runBuild(
  site: DeploySite,
  buildDir: string,
  buildEnv: Record<string, string>,
  dryRun: boolean,
): Promise<void> {
  if (site.buildCmd === "true") {
    console.log(
      `build: skipped (buildCmd is "true"; ${site.name} is pre-built)`,
    );
    return;
  }
  console.log(`+++ build: (${site.buildDir}) ${site.buildCmd}`);
  if (dryRun) {
    console.log(`DRYRUN: would run \`${site.buildCmd}\` in ${site.buildDir}`);
    return;
  }
  await run(["sh", "-c", site.buildCmd], { cwd: buildDir, env: buildEnv });
}

function selectSite(args: string[]): DeploySite {
  const positional = args.filter((a) => !a.startsWith("--"));
  const siteName = positional[0];
  if (siteName === undefined || positional.length > 1) {
    usage();
  }
  // Match by name or by bucket (bucket is space-free — preferred in scripts).
  const site = DEPLOY_SITES.find(
    (s) => s.name === siteName || s.bucket === siteName,
  );
  if (!site) {
    console.error(`Unknown site: ${siteName}`);
    usage();
  }
  return site;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
  }
  if (args.includes("--list")) {
    for (const s of DEPLOY_SITES) {
      console.log(`${s.name}\t${s.bucket}\t${s.url}`);
    }
    return;
  }

  const dryRun = args.includes("--dry-run");
  const site = selectSite(args);

  const root = repoRoot();
  const buildDir = `${root}/${site.buildDir}`;
  const distDir = `${root}/${site.distDir}`;

  console.log(`--- Deploy ${site.name} -> ${site.bucket} (${site.url})`);
  console.log(dryRun ? "(dry run)" : "(live)");

  const buildEnv = buildEnvFor(site, dryRun);
  await runBuild(site, buildDir, buildEnv, dryRun);

  const endpoint =
    site.target === "r2"
      ? `https://${requireEnv("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`
      : SEAWEEDFS_ENDPOINT;

  const haveCreds =
    optionalEnv("AWS_ACCESS_KEY_ID") !== null &&
    optionalEnv("AWS_SECRET_ACCESS_KEY") !== null;

  if (!dryRun && !haveCreds) {
    // A live deploy needs creds; fail fast with the exact missing var.
    requireEnv("AWS_ACCESS_KEY_ID");
    requireEnv("AWS_SECRET_ACCESS_KEY");
  }

  const awsEnv: Record<string, string> = {
    // SeaweedFS S3 requires s3v4 signing; pin the region to avoid mismatches
    // with newer AWS CLI versions that use CRT-based signing. The
    // WHEN_REQUIRED settings suppress checksum headers AWS CLI v2 sends by
    // default but SeaweedFS does not understand.
    AWS_DEFAULT_REGION: "us-east-1",
    AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
    AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
  };

  console.log(`+++ sync: ${site.distDir} -> s3://${site.bucket}/`);
  await s3SyncStaticSite({
    source: distDir,
    bucket: site.bucket,
    endpoint,
    immutablePrefixes: site.immutablePrefixes,
    cwd: root,
    env: awsEnv,
    dryRun,
    haveCreds,
  });

  console.log(`--- done: ${site.name}`);
}

await main();
