/**
 * Site deploy step generators.
 *
 * On non-main branches the deploy command receives `--dryrun` via DRYRUN_FLAG,
 * so the build runs but the SeaweedFS sync is skipped — PRs catch SSR/build
 * regressions (e.g. Astro OG-image generation) without publishing assets.
 *
 * The pipeline builder decides WHICH branches emit these steps (see
 * pipeline-builder.ts "Deploy sites (release) / dryrun site builds (PR)"):
 * release builds deploy every affected site; PR builds dryrun-build only the
 * sites whose source changed. Their step keys feed `ci-complete`'s depends_on,
 * so a failed dryrun blocks the merge.
 */
import type { DeploySite } from "../catalog.ts";
import { DEPLOY_SITES, PACKAGE_TO_SITE } from "../catalog.ts";
import {
  safeKey,
  RETRY,
  DAGGER_ENV,
  DRYRUN_FLAG,
  gitDir,
  gitFile,
  DAGGER_CALL,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const DRYRUN_BUILD_ENV_VALUES: Readonly<Record<string, string>> = {
  PUBLIC_PINTEREST_TAG_ID: "dev-pinterest-tag-id",
  PUBLIC_REDDIT_PIXEL_ID: "dev-reddit-pixel-id",
};

// Sentry release stamped into every static-site build so browser events are
// attributable to a deploy. The version scheme matches container images
// (2.0.0-<build>, see steps/images.ts). $BUILDKITE_BUILD_NUMBER is expanded by
// the BK agent shell when it assembles the `dagger call --build-cmd "..."`
// string, so the container receives the literal value. Vite reads VITE_*,
// Astro reads PUBLIC_*; sites without Sentry simply ignore the unused vars.
const SENTRY_RELEASE_ENV_PREFIX =
  "VITE_SENTRY_RELEASE=2.0.0-$BUILDKITE_BUILD_NUMBER " +
  "PUBLIC_SENTRY_RELEASE=2.0.0-$BUILDKITE_BUILD_NUMBER";

function isDryrunBuild(): boolean {
  const branch = Bun.env["BUILDKITE_BRANCH"];
  const defaultBranch = Bun.env["BUILDKITE_PIPELINE_DEFAULT_BRANCH"];
  if (Bun.env["DRYRUN"] === "true") return true;
  if (branch === undefined || branch === "") return false;
  if (defaultBranch === undefined || defaultBranch === "") return false;
  return branch !== defaultBranch;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function dryrunBuildEnvPrefix(buildEnvVars: string[]): string {
  return buildEnvPrefix(buildEnvVars, DRYRUN_BUILD_ENV_VALUES);
}

function buildEnvPrefix(
  buildEnvVars: string[],
  values: Readonly<Record<string, string>>,
): string {
  return buildEnvVars
    .map((name) => {
      const value = values[name];
      if (value === undefined) {
        throw new Error(`Missing build env placeholder for ${name}`);
      }
      return `${name}=${shellQuote(value)}`;
    })
    .join(" ");
}

function deploySiteStep(site: DeploySite, dependsOn: string[]): BuildkiteStep {
  const cpu = "250m";
  const memory = "512Mi";

  const pkgPath = site.buildDir.replace("packages/", "");
  const deps = WORKSPACE_DEPS[pkgPath] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [
      `--dep-names ${d}`,
      `--dep-dirs ${gitDir(`packages/${d}`)}`,
    ])
    .join(" ");
  const buildEnvVars =
    site.buildEnvVars ?? Object.keys(site.buildEnvPlaceholders ?? {});
  const hasBuildEnvPlaceholders = site.buildEnvPlaceholders !== undefined;
  const useDryrunBuildEnv = isDryrunBuild() && buildEnvVars.length > 0;
  const usePlaceholderBuildEnv = hasBuildEnvPlaceholders || useDryrunBuildEnv;
  const buildEnvFlags = usePlaceholderBuildEnv
    ? ""
    : buildEnvVars
        .flatMap((name) => [
          `--build-env-names ${name}`,
          `--build-env-values env:${name}`,
        ])
        .join(" ");
  const placeholderBuildEnvPrefix = usePlaceholderBuildEnv
    ? site.buildEnvPlaceholders === undefined
      ? dryrunBuildEnvPrefix(buildEnvVars)
      : buildEnvPrefix(buildEnvVars, site.buildEnvPlaceholders)
    : "";
  const buildCmd = usePlaceholderBuildEnv
    ? `${SENTRY_RELEASE_ENV_PREFIX} ${placeholderBuildEnvPrefix} ${site.buildCmd}`
    : `${SENTRY_RELEASE_ENV_PREFIX} ${site.buildCmd}`;

  // Compute dist subdir relative to package dir
  const distSubdir =
    site.distDir === site.buildDir
      ? "."
      : site.distDir.replace(site.buildDir + "/", "");

  // Content-hashed asset prefixes synced as immutable (default: Astro's `_astro/`).
  const immutablePrefixFlags = (site.immutablePrefixes ?? ["_astro/"])
    .map((prefix) => `--immutable-prefixes ${prefix}`)
    .join(" ");

  // Build the dagger call command for deploy-site
  const args = [
    `${DAGGER_CALL} deploy-site --pkg-dir ${gitDir(site.buildDir)}`,
    `--pkg ${pkgPath}`,
    depFlags,
    buildEnvFlags,
    `--build-cmd "${buildCmd}"`,
    `--bucket ${site.bucket}`,
    `--dist-subdir ${distSubdir}`,
    immutablePrefixFlags,
    `--target seaweedfs`,
    `--aws-access-key-id env:SEAWEEDFS_ACCESS_KEY_ID`,
    `--aws-secret-access-key env:SEAWEEDFS_SECRET_ACCESS_KEY`,
    `--tsconfig ${gitFile("tsconfig.base.json")}`,
    site.needsPlaywright ? `--needs-playwright` : "",
  ].filter(Boolean);

  return {
    label: `:ship: Deploy ${site.name}`,
    key: `deploy-${safeKey(site.bucket)}`,
    depends_on: dependsOn,
    command: args.join(" ") + DRYRUN_FLAG,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu, memory, secrets: ["buildkite-argocd-token"] })],
  };
}

export function deploySitesGroup(
  sites: DeploySite[],
  pkgKeyMap?: Map<string, string>,
  extraDependsOn: string[] = [],
): BuildkiteGroup {
  return {
    group: ":ship: Deploy Sites",
    key: "deploy-sites",
    steps: sites.map((s) => {
      // Resolve the package name from the build dir (e.g. "packages/sjer.red" → "sjer.red")
      const pkg = s.buildDir.replace("packages/", "").split("/")[0] ?? "";
      const pkgKey = pkgKeyMap?.get(pkg);
      const deps = ["quality-gate", ...extraDependsOn];
      if (pkgKey) deps.push(pkgKey);
      return deploySiteStep(s, deps);
    }),
  };
}

export function filterSites(
  affectedSitePackages: Set<string>,
  buildAll: boolean,
): DeploySite[] {
  if (buildAll) return DEPLOY_SITES;
  const siteBuckets = new Set<string>();
  for (const pkg of affectedSitePackages) {
    const buckets = PACKAGE_TO_SITE[pkg];
    if (buckets) {
      for (const bucket of buckets) siteBuckets.add(bucket);
    }
  }
  return DEPLOY_SITES.filter((s) => siteBuckets.has(s.bucket));
}
