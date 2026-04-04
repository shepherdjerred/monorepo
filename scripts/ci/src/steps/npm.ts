/**
 * NPM publish step generators.
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
): BuildkiteStep {
  const deps = WORKSPACE_DEPS[pkg.name] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  // Download pre-built dist/ artifact from per-package build step, then publish.
  // Buildkite artifact paths are relative — use tmp/ (no leading /) to match uploads.
  const artifactDir = `tmp/dist-${pkg.name}`;
  const cmd = [
    `buildkite-agent artifact download "${artifactDir}/**/*" .`,
    [
      `dagger call publish-npm --pkg-dir ./${pkg.dir} --pkg ${pkg.name}`,
      depFlags,
      `--npm-token env:NPM_TOKEN`,
      `--tsconfig ./tsconfig.base.json`,
      `--pre-built-dist ${artifactDir}`,
    ]
      .filter(Boolean)
      .join(" ") + DRYRUN_FLAG,
  ].join(" && ");
  // Look up the build group key by package name first, then by the
  // top-level package directory (handles nested packages like helm-types
  // which lives under packages/homelab/src/helm-types).
  const parentPkg = pkg.dir.replace("packages/", "").split("/")[0] ?? "";
  const pkgKey = pkgKeyMap?.get(pkg.name) ?? pkgKeyMap?.get(parentPkg);
  const dependsOn = pkgKey ? ["quality-gate", pkgKey] : ["quality-gate"];
  return {
    label: `:npm: Publish ${pkg.name}`,
    key: `npm-${safeKey(pkg.name)}`,
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
): BuildkiteGroup {
  return {
    group: ":npm: Publish NPM",
    key: "publish-npm",
    steps: packages.map((pkg) => npmPublishStep(pkg, pkgKeyMap)),
  };
}
