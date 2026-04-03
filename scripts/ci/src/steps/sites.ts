/**
 * Site deploy step generators.
 */
import type { DeploySite } from "../catalog.ts";
import { DEPLOY_SITES, PACKAGE_TO_SITE } from "../catalog.ts";
import { safeKey, RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function deploySiteStep(site: DeploySite, dependsOn: string[]): BuildkiteStep {
  const cpu = "250m";
  const memory = "512Mi";

  const pkgPath = site.buildDir.replace("packages/", "");
  const deps = WORKSPACE_DEPS[pkgPath] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");

  // Compute dist subdir relative to package dir
  const distSubdir = site.distDir.replace(site.buildDir + "/", "") || ".";

  // Build dagger call command for deploy-site
  const args = [
    `dagger call deploy-site --pkg-dir ./${site.buildDir}`,
    `--pkg ${pkgPath}`,
    depFlags,
    `--build-cmd "${site.buildCmd || "true"}"`,
    `--bucket ${site.bucket}`,
    `--dist-subdir ${distSubdir}`,
    `--target seaweedfs`,
    `--aws-access-key-id env:SEAWEEDFS_ACCESS_KEY_ID`,
    `--aws-secret-access-key env:SEAWEEDFS_SECRET_ACCESS_KEY`,
    `--tsconfig ./tsconfig.base.json`,
    site.needsPlaywright ? `--needs-playwright` : "",
  ].filter(Boolean);

  return {
    label: `:ship: Deploy ${site.name}`,
    key: `deploy-${safeKey(site.bucket)}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: args.join(" ") + DRYRUN_FLAG,
    timeout_in_minutes: 15,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu, memory, secrets: ["buildkite-argocd-token"] })],
  };
}

export function deploySitesGroup(
  sites: DeploySite[],
  dependsOn: string[],
): BuildkiteGroup {
  return {
    group: ":ship: Deploy Sites",
    key: "deploy-sites",
    steps: sites.map((s) => deploySiteStep(s, dependsOn)),
  };
}

export function filterSites(
  affectedSitePackages: Set<string>,
  buildAll: boolean,
): DeploySite[] {
  if (buildAll) return DEPLOY_SITES;
  const siteBuckets = new Set<string>();
  for (const pkg of affectedSitePackages) {
    const bucket = PACKAGE_TO_SITE[pkg];
    if (bucket) siteBuckets.add(bucket);
  }
  return DEPLOY_SITES.filter((s) => siteBuckets.has(s.bucket));
}
