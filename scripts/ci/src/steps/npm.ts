/**
 * NPM publish step generators.
 *
 * Dev releases (every commit): version <pkg-version>-dev.BUILD, --tag dev
 * Prod releases (release-please merge): version from package.json, --tag latest
 *
 * Build + publish happens in a single Dagger call (no Buildkite artifact transfer).
 * See decisions/2026-04-04_unified-versioning-strategy.md
 */
import { NPM_PACKAGES, PACKAGE_TO_NPM } from "../catalog.ts";
import type { NpmPackage } from "../catalog.ts";
import {
  RETRY,
  DAGGER_ENV,
  DRYRUN_FLAG,
  gitFile,
  DAGGER_CALL,
  REPO_GIT_REF,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * One BK pod publishes every npm package in parallel via `npm-publish-all`.
 * Bundle's children share the same `devSuffix`, so on release-please merges
 * we emit TWO bundle steps (`npm-publish-all-prod` + `npm-publish-all-dev`);
 * on every other main build, only the dev step.
 */
function npmPublishAllStep(
  packages: NpmPackage[],
  pkgKeyMap: Map<string, string> | undefined,
  mode: "dev" | "prod",
): BuildkiteStep {
  const suffix = mode === "prod" ? "-prod" : "";
  const labelSuffix = mode === "prod" ? "latest" : "dev";
  // pkg-path = on-disk path under packages/. Required so the Dagger function
  // mounts each package at its real source-tree location, otherwise `file:`
  // refs in package.json (which are written relative to the source layout)
  // resolve to wrong paths inside the container.
  const pkgFlags = packages.map((p) => `--pkgs ${p.name}`).join(" ");
  const pkgPathFlags = packages
    .map((p) => `--pkg-paths ${p.dir.replace(/^packages\//, "")}`)
    .join(" ");
  const devSuffixFlag =
    mode === "dev" ? ` --dev-suffix "$BUILDKITE_BUILD_NUMBER"` : "";

  // depends_on: every package's pkg-check key (collected so the bundle waits
  // for every NPM package's pre-publish validation to land).
  const pkgDeps = packages
    .flatMap((p) => {
      const parentPkg = p.dir.replace("packages/", "").split("/")[0] ?? "";
      const k = pkgKeyMap?.get(p.name) ?? pkgKeyMap?.get(parentPkg);
      return k === undefined ? [] : [k];
    })
    .filter((v, i, a) => a.indexOf(v) === i);
  const dependsOn = ["quality-gate", ...pkgDeps];

  const cmd =
    [
      `${DAGGER_CALL} npm-publish-all --source ${REPO_GIT_REF}`,
      pkgFlags,
      pkgPathFlags,
      `--npm-token env:NPM_TOKEN`,
      `--tsconfig ${gitFile("tsconfig.base.json")}`,
    ]
      .filter(Boolean)
      .join(" ") +
    devSuffixFlag +
    DRYRUN_FLAG;

  return {
    label: `:npm: Publish NPM (${String(packages.length)} packages, ${labelSuffix})`,
    key: `npm-publish-all${suffix}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "500m", memory: "1Gi" })],
  };
}

export function filterNpmPackages(
  affectedNpmPackages: Set<string>,
  buildAll: boolean,
): NpmPackage[] {
  if (buildAll) return NPM_PACKAGES;
  const npmNames = new Set<string>();
  for (const pkg of affectedNpmPackages) {
    const names = PACKAGE_TO_NPM[pkg];
    if (names) {
      for (const n of names) npmNames.add(n);
    }
  }
  return NPM_PACKAGES.filter((p) => npmNames.has(p.name));
}

export function publishNpmGroup(
  packages: NpmPackage[],
  pkgKeyMap?: Map<string, string>,
  releasePleaseMerge = false,
): BuildkiteGroup {
  const steps: BuildkiteStep[] = [];
  if (releasePleaseMerge) {
    steps.push(npmPublishAllStep(packages, pkgKeyMap, "prod"));
  }
  steps.push(npmPublishAllStep(packages, pkgKeyMap, "dev"));
  return {
    group: ":npm: Publish NPM",
    key: "publish-npm",
    steps,
  };
}
