#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { optionalEnv, run } from "../lib/run.ts";
import {
  readScoutPostHogSite,
  requireMarketingIdentifiers,
} from "../lib/scout/scout-analytics-config.ts";
import {
  CANONICAL_DIGEST_PATTERN,
  resolveBackendDigest,
  ScoutReleaseStateSchema,
  siteReleaseIdentity,
  type ScoutReleaseState,
} from "../lib/scout/scout-release-state.ts";
import {
  DELIVERY_SCOUT_RELEASE_WORK_DIR,
  hashSiteArchive,
} from "../lib/scout/scout-archive.ts";

const SITE_PACKAGE_DIR = "packages/scout-for-lol";
const DIST_DIR = "packages/scout-for-lol/packages/frontend/dist";
const PLACEHOLDER_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const MARKETING_ENV_NAMES = [
  "PUBLIC_PINTEREST_TAG_ID",
  "PUBLIC_REDDIT_PIXEL_ID",
] as const;
const ANALYTICS_REGISTRY_PATH = "config/analytics-sites.json";
const RELEASE_INPUT_PATHS = [
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "patches",
  "turbo.json",
  "packages/scout-for-lol",
  "packages/astro-opengraph-images",
  "packages/llm-models",
  "packages/glitter-context",
  "scripts/package.json",
  "scripts/release/scout-site-release.ts",
  "scripts/lib",
  ANALYTICS_REGISTRY_PATH,
  "docker-bake.hcl",
  ".dockerignore",
] as const;

function repoRoot(): string {
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

async function marketingIdentifiers(): Promise<{
  pinterestTagId: string;
  redditPixelId: string;
}> {
  const prodSite = await readScoutPostHogSite(repoRoot(), "prod");
  return requireMarketingIdentifiers(prodSite);
}

async function resolveGitSha(): Promise<string> {
  const fromCi = optionalEnv("CI_COMMIT_SHA");
  if (fromCi !== null) {
    return fromCi;
  }
  const result = await run(["git", "rev-parse", "HEAD"], { capture: true });
  return result.stdout.trim();
}

async function contractHash(): Promise<string> {
  const result = await run(
    ["bun", "--no-install", "packages/scout-for-lol/scripts/contract-hash.ts"],
    { cwd: repoRoot(), capture: true },
  );
  return result.stdout.trim();
}

export async function hashReleaseInputFiles(
  root: string,
  paths: readonly string[],
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const filePath of [...paths].sort()) {
    hasher.update(`${filePath}\0`);
    hasher.update(await Bun.file(`${root}/${filePath}`).bytes());
  }
  return `sha256:${hasher.digest("hex")}`;
}

/**
 * Content-address a Scout release by its build inputs. `sourceCommit` and
 * `version` are part of the identity on purpose: `buildSite` bakes both into
 * the deployable bytes (`VITE_GIT_SHA` / `PUBLIC_GIT_SHA` and
 * `VITE_APP_VERSION` / `PUBLIC_APP_VERSION`), so the bytes are
 * commit- and version-dependent. Leaving either out lets two releases share
 * an archive identity yet produce different bytes, tripping the
 * immutable-archive guard — and, for version, leaving a reused archive
 * displaying a stale `2.0.0-<build>` after `retagScoutReleaseState`.
 * Binding the identity to those baked fields keeps content-addressing
 * honest: same identity ⇒ same bytes.
 */
export function computeReleaseInputDigest(inputs: {
  version: string;
  sourceCommit: string;
  backendImageDigest: string;
  sourceInputsDigest: string;
  contractHash: string;
  pinterestTagId: string;
  redditPixelId: string;
}): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    JSON.stringify({
      schema: "scout-release-input/v4",
      version: inputs.version,
      sourceCommit: inputs.sourceCommit,
      backendImageDigest: inputs.backendImageDigest,
      sourceInputsDigest: inputs.sourceInputsDigest,
      contractHash: inputs.contractHash,
      analyticsProvider: "posthog-cloud-us",
      pinterestTagId: inputs.pinterestTagId,
      redditPixelId: inputs.redditPixelId,
    }),
  );
  return `sha256:${hasher.digest("hex")}`;
}

export async function writeScoutReleaseState(
  output: string,
  state: ScoutReleaseState,
): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  await Bun.write(output, `${JSON.stringify(state)}\n`);
}

async function releaseSourceDigest(): Promise<string> {
  const tracked = await run(
    ["git", "ls-files", "-z", "--", ...RELEASE_INPUT_PATHS],
    { cwd: repoRoot(), capture: true, secret: true },
  );
  const paths = tracked.stdout
    .split("\0")
    .filter((filePath) => filePath !== "");
  if (paths.length === 0) {
    throw new Error("Scout release input selection is empty");
  }
  return await hashReleaseInputFiles(repoRoot(), paths);
}

async function buildSite(
  flavor: "prod" | "beta",
  state: ScoutReleaseState,
  dryRun: boolean,
): Promise<void> {
  const sourceCommit = await resolveGitSha();
  if (sourceCommit !== state.sourceCommit) {
    throw new Error(
      `release state source ${state.sourceCommit} does not match checkout ${sourceCommit}`,
    );
  }
  const identity = siteReleaseIdentity(state);
  const posthogSite = await readScoutPostHogSite(repoRoot(), flavor);
  const env: Record<string, string> = {
    VITE_SENTRY_RELEASE: identity,
    PUBLIC_SENTRY_RELEASE: identity,
    // Footer / mismatch chip: 2.0.0-<build>. Sentry and the archive keep
    // `identity` (scout-site@sha256:…), which is the content-addressed id.
    VITE_APP_VERSION: state.version,
    PUBLIC_APP_VERSION: state.version,
    VITE_GIT_SHA: sourceCommit,
    PUBLIC_GIT_SHA: sourceCommit,
    VITE_CONTRACT_HASH: await contractHash(),
    VITE_POSTHOG_PROJECT_TOKEN: posthogSite.projectToken,
    VITE_POSTHOG_API_HOST: posthogSite.proxyHost,
    VITE_POSTHOG_ASSET_HOST: posthogSite.proxyHost,
    VITE_POSTHOG_SITE_KEY: posthogSite.key,
    VITE_POSTHOG_SITE_DOMAIN: posthogSite.domain,
    VITE_POSTHOG_SESSION_REPLAY: String(posthogSite.sessionReplay),
    PUBLIC_POSTHOG_PROJECT_TOKEN: posthogSite.projectToken,
    PUBLIC_POSTHOG_API_HOST: posthogSite.proxyHost,
    PUBLIC_POSTHOG_ASSET_HOST: posthogSite.proxyHost,
    PUBLIC_POSTHOG_SITE_KEY: posthogSite.key,
    PUBLIC_POSTHOG_SITE_DOMAIN: posthogSite.domain,
    PUBLIC_POSTHOG_SESSION_REPLAY: String(posthogSite.sessionReplay),
    PUBLIC_DOCS_SITE_ORIGIN:
      flavor === "prod"
        ? "https://scout-for-lol.com"
        : "https://beta.scout-for-lol.com",
    // Beta-only documentation is excluded from the collection at build time,
    // so the pages are physically absent from the prod artifact rather than
    // redirected. Both flavors are built here from one source tree and hashed
    // separately, and `assertScoutArchiveBytes` verifies each digest, so a
    // beta-only page cannot leak into prod by accident.
    PUBLIC_SCOUT_SITE_FLAVOR: flavor,
  };
  if (flavor === "prod") {
    const marketing = await marketingIdentifiers();
    env["PUBLIC_PINTEREST_TAG_ID"] = marketing.pinterestTagId;
    env["PUBLIC_REDDIT_PIXEL_ID"] = marketing.redditPixelId;
  }
  if (dryRun) {
    console.log(`DRYRUN: would build ${flavor} site as ${identity}`);
    return;
  }
  await run(["bun", "--no-install", "run", "scripts/build-bucket.ts"], {
    cwd: `${repoRoot()}/${SITE_PACKAGE_DIR}`,
    env,
    unsetEnv: flavor === "beta" ? [...MARKETING_ENV_NAMES] : [],
  });
}

function requiredArg(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value === "") {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function parseScoutPreparationArgs(args: string[]) {
  const { values } = parseArgs({
    args: args.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      output: { type: "string" },
      "build-number": { type: "string" },
      "backend-digest": { type: "string" },
      "delivery-archive": { type: "boolean", default: false },
      "dry-run": { type: "boolean" },
    },
  });
  const output = requiredArg(args, "--output");
  const buildNumber = Number(values["build-number"]);
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new Error("--build-number must be a positive integer");
  }
  const backendImageDigest = values["backend-digest"];
  if (
    backendImageDigest === undefined ||
    !CANONICAL_DIGEST_PATTERN.test(backendImageDigest)
  )
    throw new Error("--backend-digest must be a canonical sha256 digest");
  return {
    output,
    buildNumber,
    backendImageDigest,
    workDirectory: DELIVERY_SCOUT_RELEASE_WORK_DIR,
  };
}

async function prepareState(args: string[], dryRun: boolean): Promise<void> {
  const { output, buildNumber, backendImageDigest, workDirectory } =
    parseScoutPreparationArgs(args);
  const sourceCommit = await resolveGitSha();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error(`source commit is not canonical: ${sourceCommit}`);
  }
  const marketing = await marketingIdentifiers();
  const version = `2.0.0-${buildNumber.toString()}`;
  const releaseInputDigest = computeReleaseInputDigest({
    version,
    sourceCommit,
    backendImageDigest,
    sourceInputsDigest: await releaseSourceDigest(),
    contractHash: await contractHash(),
    pinterestTagId: marketing.pinterestTagId,
    redditPixelId: marketing.redditPixelId,
  });
  const provisional = ScoutReleaseStateSchema.parse({
    schema: "scout-release-state/v1",
    buildNumber,
    version,
    sourceCommit,
    backendImageDigest,
    siteArchiveDigest: PLACEHOLDER_DIGEST,
    betaSiteArchiveDigest: PLACEHOLDER_DIGEST,
    releaseInputDigest,
  });
  const releaseDir = `${repoRoot()}/${workDirectory}`;
  if (dryRun) {
    await buildSite("prod", provisional, true);
    await buildSite("beta", provisional, true);
    await writeScoutReleaseState(output, provisional);
    return;
  }
  await Bun.$`rm -rf ${releaseDir}`.quiet();
  await Bun.$`mkdir -p ${releaseDir}`.quiet();
  for (const flavor of ["prod", "beta"] as const) {
    await buildSite(flavor, provisional, false);
    await run([
      "cp",
      "-R",
      `${repoRoot()}/${DIST_DIR}`,
      `${releaseDir}/${flavor}`,
    ]);
  }
  const state = ScoutReleaseStateSchema.parse({
    ...provisional,
    siteArchiveDigest: await hashSiteArchive(`${releaseDir}/prod`),
    betaSiteArchiveDigest: await hashSiteArchive(`${releaseDir}/beta`),
  });
  await writeScoutReleaseState(output, state);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args[0] === "prepare-state") {
    await prepareState(args, args.includes("--dry-run"));
    return;
  }
  if (args[0] === "resolve-backend-digest") {
    const source = await readBackendCatalogSource(args);
    process.stdout.write(`${resolveBackendDigest(null, source)}\n`);
    return;
  }
  throw new Error(
    "Use prepare-state or resolve-backend-digest --version-catalog-file PATH; activation is owned by Delivery",
  );
}
/** Read-only rehearsal input; live publication resolves original qualified artifacts separately. */
export async function readBackendCatalogSource(
  args: string[],
): Promise<string> {
  return Bun.file(requiredArg(args, "--version-catalog-file")).text();
}
if (import.meta.main) await main();
