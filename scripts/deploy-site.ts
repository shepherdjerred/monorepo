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
import {
  s3SyncStaticSite,
  SEAWEEDFS_ENDPOINT,
  SEAWEEDFS_AWS_ENV,
} from "./lib/s3-static-site.ts";

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
    // xelatex compiles the gitignored resume.pdf; CI deploys --prebuilt (the
    // resume-build step's artifact) because only the texlive container has TeX.
    buildCmd: "bun run build",
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
  // NOTE: the scout-for-lol buckets (scout-frontend, scout-frontend-beta) are
  // deliberately NOT in this catalog. Their deploys are versioned and
  // stage-pinned via scripts/scout-site-release.ts (archive / deploy-beta /
  // reconcile-prod) so prod site content stays in lockstep with the promoted
  // backend image — a manual deploy-site.ts sync would reintroduce the
  // unversioned skew that crashed the prod SPA against the pinned backend.
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

// ---------------------------------------------------------------------------
// Repo root resolution
// ---------------------------------------------------------------------------

/** Repo root = two levels up from this file (scripts/deploy-site.ts). */
function repoRoot(): string {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage: bun scripts/deploy-site.ts <site-name|bucket> [--dry-run] [--prebuilt]\n" +
      "       bun scripts/deploy-site.ts --list\n\n" +
      "--prebuilt skips the site's buildCmd and requires distDir to already\n" +
      "contain files (e.g. a CI artifact built in a specialized container).\n\n" +
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
  const prebuilt = args.includes("--prebuilt");
  const site = selectSite(args);

  const root = repoRoot();
  const buildDir = `${root}/${site.buildDir}`;
  const distDir = `${root}/${site.distDir}`;

  console.log(`--- Deploy ${site.name} -> ${site.bucket} (${site.url})`);
  console.log(dryRun ? "(dry run)" : "(live)");

  if (prebuilt) {
    // The dist was produced elsewhere (e.g. a CI artifact from a container
    // with build-only tooling like playwright browsers). Refuse to sync a
    // missing/empty dir — with --delete that would wipe the bucket.
    const glob = new Bun.Glob("**/*");
    let fileCount = 0;
    try {
      for await (const _ of glob.scan({ cwd: distDir, onlyFiles: true })) {
        fileCount += 1;
        break;
      }
    } catch (error) {
      // Missing dir (ENOENT) → same refusal as empty; anything else is real.
      const isEnoent =
        error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!isEnoent) throw error;
    }
    if (fileCount === 0) {
      throw new Error(
        `--prebuilt: ${site.distDir} is missing or empty — refusing to sync`,
      );
    }
    console.log(
      `build: skipped (--prebuilt; syncing existing ${site.distDir})`,
    );
  } else {
    const buildEnv = buildEnvFor(site, dryRun);
    await runBuild(site, buildDir, buildEnv, dryRun);
  }

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

  // Every site in the catalog ships a root index.html. Refuse a live sync
  // without it: pass 2 runs with --delete, so a dist missing its root files
  // (e.g. build 5648's artifact, where the `**/*` glob dropped every
  // root-level file) would wipe them from the bucket and take the site down.
  // Dry runs may legitimately have no dist (the build is skipped).
  if (!dryRun && !(await Bun.file(`${distDir}/index.html`).exists())) {
    throw new Error(
      `${site.distDir}/index.html is missing — refusing to sync (--delete would remove the site's root files from s3://${site.bucket}/)`,
    );
  }

  console.log(`+++ sync: ${site.distDir} -> s3://${site.bucket}/`);
  await s3SyncStaticSite({
    source: distDir,
    bucket: site.bucket,
    endpoint,
    immutablePrefixes: site.immutablePrefixes,
    cwd: root,
    env: SEAWEEDFS_AWS_ENV,
    dryRun,
    haveCreds,
  });

  console.log(`--- done: ${site.name}`);
}

await main();
