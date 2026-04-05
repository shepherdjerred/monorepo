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
import { safeKey, RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function npmPublishStep(
  pkg: { name: string; dir: string },
  pkgKeyMap?: Map<string, string>,
  mode: "dev" | "prod" = "dev",
): BuildkiteStep {
  const deps = WORKSPACE_DEPS[pkg.name] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  const devSuffixFlag =
    mode === "dev" ? ` --dev-suffix "$BUILDKITE_BUILD_NUMBER"` : "";
  const cmd =
    [
      `dagger call publish-npm --pkg-dir ./${pkg.dir} --pkg ${pkg.name}`,
      depFlags,
      `--npm-token env:NPM_TOKEN`,
      `--tsconfig ./tsconfig.base.json`,
    ]
      .filter(Boolean)
      .join(" ") +
    devSuffixFlag +
    DRYRUN_FLAG;
  const parentPkg = pkg.dir.replace("packages/", "").split("/")[0] ?? "";
  const pkgKey = pkgKeyMap?.get(pkg.name) ?? pkgKeyMap?.get(parentPkg);
  const dependsOn = pkgKey ? ["quality-gate", pkgKey] : ["quality-gate"];
  const suffix = mode === "prod" ? "-prod" : "";
  const labelSuffix = mode === "prod" ? " (latest)" : " (dev)";
  return {
    label: `:npm: Publish ${pkg.name}${labelSuffix}`,
    key: `npm-${safeKey(pkg.name)}${suffix}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 10,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
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
  for (const pkg of packages) {
    if (releasePleaseMerge) {
      steps.push(npmPublishStep(pkg, pkgKeyMap, "prod"));
    }
    steps.push(npmPublishStep(pkg, pkgKeyMap, "dev"));
  }
  return {
    group: ":npm: Publish NPM",
    key: "publish-npm",
    steps,
  };
}
