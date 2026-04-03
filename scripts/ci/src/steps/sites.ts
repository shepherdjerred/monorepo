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
    `--build-cmd "${site.buildCmd}"`,
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
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu, memory, secrets: ["buildkite-argocd-token"] })],
  };
}

export function deploySitesGroup(
  sites: DeploySite[],
  pkgKeyMap?: Map<string, string>,
): BuildkiteGroup {
  return {
    group: ":ship: Deploy Sites",
    key: "deploy-sites",
    steps: sites.map((s) => {
      // Resolve the package name from the build dir (e.g. "packages/sjer.red" → "sjer.red")
      const pkg = s.buildDir.replace("packages/", "").split("/")[0] ?? "";
      const pkgKey = pkgKeyMap?.get(pkg);
      const deps = ["release"];
      if (pkgKey) deps.push(pkgKey);
      return deploySiteStep(s, deps);
    }),
  };
}

/**
 * MkDocs docs deploy — build with mkdocs (Python), export, then deploy via deploy-site (awscli inside Dagger).
 * Two-step pipeline: mkdocs-build produces the site/, then deploy-site syncs to S3.
 */
export function mkdocsDeployStep(dependsOn: string[]): BuildkiteStep {
  return {
    label: ":book: Deploy discord-plays-pokemon docs",
    key: "deploy-discord-plays-pokemon-docs",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command:
      [
        // Step 1: Build with mkdocs (Python container), export built site to local path
        `dagger call mkdocs-build --source . export --path /tmp/mkdocs-site`,
        // Step 2: Deploy built site via deploy-site (awscli inside Dagger container)
        `dagger call deploy-site --pkg-dir /tmp/mkdocs-site --pkg discord-plays-pokemon --build-cmd "true" --bucket discord-plays-pokemon-docs --dist-subdir . --target seaweedfs --aws-access-key-id env:SEAWEEDFS_ACCESS_KEY_ID --aws-secret-access-key env:SEAWEEDFS_SECRET_ACCESS_KEY`,
      ].join(" && ") + DRYRUN_FLAG,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
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
