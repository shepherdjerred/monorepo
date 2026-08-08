#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { optionalEnv, requireEnv, run } from "./lib/run.ts";
import {
  CANONICAL_DIGEST_PATTERN,
  parseScoutReleaseState,
  retagScoutReleaseState,
  resolveBackendDigest,
  resolveProdPin,
  SCOUT_VERSION_PATTERN,
  ScoutReleaseStateSchema,
  siteReleaseIdentity,
  validateProdPinState,
  type ScoutReleaseState,
} from "./lib/scout-release-state.ts";
import { reconcileLegacyScoutProd } from "./lib/scout-legacy-site-storage.ts";
import {
  archiveScout,
  assertScoutArchiveBytes,
  deployScoutBeta,
  hashSiteArchive,
  readScoutStateByVersion,
  reconcileScoutProd,
  readScoutStateByInput,
  SCOUT_RELEASE_WORK_DIR,
} from "./lib/scout-site-storage.ts";

const SITE_PACKAGE_DIR = "packages/scout-for-lol";
const DIST_DIR = "packages/scout-for-lol/packages/frontend/dist";
const IMAGE_REPO = "ghcr.io/shepherdjerred/scout-for-lol";
const PLACEHOLDER_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const BETA_PIXEL_PLACEHOLDERS: Readonly<Record<string, string>> = {
  PUBLIC_PINTEREST_TAG_ID: "beta-placeholder-pinterest-tag-id",
  PUBLIC_REDDIT_PIXEL_ID: "beta-placeholder-reddit-pixel-id",
};
const ANALYTICS_REGISTRY_PATH = "config/analytics-sites.json";
const AnalyticsRegistrySchema = z
  .object({
    trackerOrigin: z.literal("https://matomo.sjer.red"),
    sites: z.array(
      z.object({
        hostname: z.string().min(1),
        siteId: z.number().int().positive(),
      }),
    ),
  })
  .superRefine((registry, context) => {
    const hostnames = new Set<string>();
    const siteIds = new Set<number>();
    for (const site of registry.sites) {
      if (hostnames.has(site.hostname)) {
        context.addIssue({
          code: "custom",
          path: ["sites"],
          message: `Duplicate analytics hostname: ${site.hostname}`,
        });
      }
      if (siteIds.has(site.siteId)) {
        context.addIssue({
          code: "custom",
          path: ["sites"],
          message: `Duplicate analytics site ID: ${String(site.siteId)}`,
        });
      }
      hostnames.add(site.hostname);
      siteIds.add(site.siteId);
    }
  });
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
  "scripts/scout-site-release.ts",
  "scripts/lib",
  ANALYTICS_REGISTRY_PATH,
  "docker-bake.hcl",
  ".dockerignore",
] as const;

function repoRoot(): string {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
}

async function readMatomoSite(flavor: "prod" | "beta"): Promise<{
  domain: string;
  siteId: string;
}> {
  const registryRaw: unknown = JSON.parse(
    await Bun.file(`${repoRoot()}/${ANALYTICS_REGISTRY_PATH}`).text(),
  );
  const registry = AnalyticsRegistrySchema.parse(registryRaw);
  const domain =
    flavor === "prod" ? "scout-for-lol.com" : "beta.scout-for-lol.com";
  const matchingSites = registry.sites.filter(
    (candidate) => candidate.hostname === domain,
  );
  if (matchingSites.length !== 1) {
    throw new Error(
      `Analytics registry must have exactly one Matomo site for ${domain}`,
    );
  }
  const site = matchingSites[0];
  return { domain: site.hostname, siteId: String(site.siteId) };
}

async function resolveGitSha(): Promise<string> {
  const fromCi = optionalEnv("BUILDKITE_COMMIT");
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
 * Content-address a Scout release by its build inputs. `sourceCommit` is part
 * of the identity on purpose: the site build bakes the commit into the
 * deployable bytes (`VITE_GIT_SHA` / `PUBLIC_GIT_SHA` in `buildSite`), so the
 * bytes are commit-dependent. Leaving the commit out let two commits with
 * otherwise-identical inputs share an archive identity yet produce different
 * bytes, tripping the immutable-archive guard — and, once a build was canceled
 * mid-archive, the orphaned record wedged every later release. Binding the
 * identity to the commit keeps content-addressing honest: same identity ⇒ same
 * bytes.
 */
export function computeReleaseInputDigest(inputs: {
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
      schema: "scout-release-input/v2",
      sourceCommit: inputs.sourceCommit,
      backendImageDigest: inputs.backendImageDigest,
      sourceInputsDigest: inputs.sourceInputsDigest,
      contractHash: inputs.contractHash,
      matomoTrackerOrigin: "https://matomo.sjer.red",
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
  const matomoSite = await readMatomoSite(flavor);
  const env: Record<string, string> = {
    VITE_SENTRY_RELEASE: identity,
    PUBLIC_SENTRY_RELEASE: identity,
    VITE_APP_VERSION: identity,
    PUBLIC_APP_VERSION: identity,
    VITE_GIT_SHA: sourceCommit,
    PUBLIC_GIT_SHA: sourceCommit,
    VITE_CONTRACT_HASH: await contractHash(),
    VITE_MATOMO_SITE_ID: matomoSite.siteId,
    VITE_MATOMO_SITE_DOMAIN: matomoSite.domain,
    PUBLIC_MATOMO_SITE_ID: matomoSite.siteId,
  };
  if (flavor === "prod") {
    env["PUBLIC_PINTEREST_TAG_ID"] = requireEnv("PUBLIC_PINTEREST_TAG_ID");
    env["PUBLIC_REDDIT_PIXEL_ID"] = requireEnv("PUBLIC_REDDIT_PIXEL_ID");
  } else {
    Object.assign(env, BETA_PIXEL_PLACEHOLDERS);
  }
  if (dryRun) {
    console.log(`DRYRUN: would build ${flavor} site as ${identity}`);
    return;
  }
  await run(["bun", "--no-install", "run", "scripts/build-bucket.ts"], {
    cwd: `${repoRoot()}/${SITE_PACKAGE_DIR}`,
    env,
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

function stateArg(args: string[]): ScoutReleaseState {
  return parseScoutReleaseState(requiredArg(args, "--state"));
}

async function prepareState(args: string[], dryRun: boolean): Promise<void> {
  const output = requiredArg(args, "--output");
  const buildNumber = Number.parseInt(requiredArg(args, "--build-number"), 10);
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new Error("--build-number must be a positive integer");
  }
  const backendImageDigest = requiredArg(args, "--backend-digest");
  if (!CANONICAL_DIGEST_PATTERN.test(backendImageDigest)) {
    throw new Error("--backend-digest must be a canonical sha256 digest");
  }
  const sourceCommit = await resolveGitSha();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error(`source commit is not canonical: ${sourceCommit}`);
  }
  const releaseInputDigest = computeReleaseInputDigest({
    sourceCommit,
    backendImageDigest,
    sourceInputsDigest: await releaseSourceDigest(),
    contractHash: await contractHash(),
    pinterestTagId: requireEnv("PUBLIC_PINTEREST_TAG_ID"),
    redditPixelId: requireEnv("PUBLIC_REDDIT_PIXEL_ID"),
  });
  const provisional = ScoutReleaseStateSchema.parse({
    schema: "scout-release-state/v1",
    buildNumber,
    version: `2.0.0-${buildNumber.toString()}`,
    sourceCommit,
    backendImageDigest,
    siteArchiveDigest: PLACEHOLDER_DIGEST,
    betaSiteArchiveDigest: PLACEHOLDER_DIGEST,
    releaseInputDigest,
  });
  if (!dryRun) {
    const existing = await readScoutStateByInput(
      provisional.releaseInputDigest,
    );
    if (existing !== null) {
      const alias = retagScoutReleaseState(existing, buildNumber);
      await writeScoutReleaseState(output, alias);
      console.log(
        `--- Reusing Scout release inputs from ${existing.version} as ${alias.version}`,
      );
      return;
    }
  }
  const releaseDir = `${repoRoot()}/${SCOUT_RELEASE_WORK_DIR}`;
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

async function resolveProdState(prodPin: string): Promise<ScoutReleaseState> {
  const [version] = prodPin.split("@");
  if (version === undefined || !SCOUT_VERSION_PATTERN.test(version)) {
    throw new Error("production pin has no canonical Scout release version");
  }
  const state = await readScoutStateByVersion(version);
  if (state === null) {
    throw new Error(`no content-addressed Scout release state for ${version}`);
  }
  validateProdPinState(prodPin, state);
  return state;
}

async function reconcileProdPin(
  prodPin: string,
  dryRun: boolean,
): Promise<void> {
  const [version, digest, ...extra] = prodPin.split("@");
  if (
    version === undefined ||
    digest === undefined ||
    !SCOUT_VERSION_PATTERN.test(version) ||
    !CANONICAL_DIGEST_PATTERN.test(digest) ||
    extra.length > 0
  ) {
    throw new Error("production pin is not canonical");
  }
  if (dryRun) {
    console.log(
      `DRYRUN: would resolve production release ${version} and reconcile its verified archive`,
    );
    return;
  }
  const state = await readScoutStateByVersion(version);
  if (state === null) {
    await reconcileLegacyScoutProd(version, digest, false);
    return;
  }
  validateProdPinState(prodPin, state);
  await reconcileScoutProd(state, false);
}

async function tagRelease(
  state: ScoutReleaseState,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    console.log(`DRYRUN: would tag ${IMAGE_REPO}:${state.version}`);
    return;
  }
  requireEnv("AWS_ACCESS_KEY_ID");
  requireEnv("AWS_SECRET_ACCESS_KEY");
  await assertScoutArchiveBytes(state, "prod");
  await assertScoutArchiveBytes(state, "beta");
  await run([
    "docker",
    "buildx",
    "imagetools",
    "create",
    "--tag",
    `${IMAGE_REPO}:${state.version}`,
    `${IMAGE_REPO}@${state.backendImageDigest}`,
  ]);
}

function usage(): never {
  console.error(
    "Usage: scout-site-release.ts <resolve-backend-digest|resolve-prod-pin|resolve-prod-state|prepare-state|archive|deploy-beta|reconcile-prod|reconcile-prod-pin|tag-release> [options]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const command = args[0];
  const dryRun = args.includes("--dry-run");
  if (command === undefined) {
    usage();
  }
  switch (command) {
    case "resolve-backend-digest": {
      const index = args.indexOf("--candidate-digest");
      const candidate = index === -1 ? null : (args[index + 1] ?? "");
      const source = await Bun.file(
        `${repoRoot()}/packages/homelab/src/cdk8s/src/versions.ts`,
      ).text();
      process.stdout.write(`${resolveBackendDigest(candidate, source)}\n`);
      break;
    }
    case "resolve-prod-pin": {
      const source = await Bun.file(
        `${repoRoot()}/packages/homelab/src/cdk8s/src/versions.ts`,
      ).text();
      process.stdout.write(`${resolveProdPin(source)}\n`);
      break;
    }
    case "resolve-prod-state": {
      const state = await resolveProdState(requiredArg(args, "--prod-pin"));
      process.stdout.write(`${JSON.stringify(state)}\n`);
      break;
    }
    case "prepare-state":
      await prepareState(args, dryRun);
      break;
    case "archive":
      await archiveScout(stateArg(args), dryRun);
      break;
    case "deploy-beta":
      await deployScoutBeta(stateArg(args), dryRun);
      break;
    case "reconcile-prod":
      await reconcileScoutProd(stateArg(args), dryRun);
      break;
    case "reconcile-prod-pin":
      await reconcileProdPin(requiredArg(args, "--prod-pin"), dryRun);
      break;
    case "tag-release":
      await tagRelease(stateArg(args), dryRun);
      break;
    default:
      usage();
  }
}

if (import.meta.main) {
  await main();
}
