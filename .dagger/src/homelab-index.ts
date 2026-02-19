import type { Directory, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { execOrThrow } from "./lib-errors.ts";
import { getMiseRuntimeContainer } from "./lib-mise.ts";
import { buildAllCharts } from "./homelab-helm.ts";
import {
  prepareHaContainer,
  typeCheckHaWithContainer,
  lintHaWithContainer,
} from "./homelab-ha.ts";
import {
  prepareCdk8sContainer,
  typeCheckCdk8sWithContainer,
  lintCdk8sWithContainer,
  testCdk8sWithContainer,
} from "./homelab-cdk8s.ts";
import { withEslintConfig } from "./homelab-base.ts";
import { sync as argocdSync } from "./homelab-argocd.ts";
import { Stage } from "./lib-types.ts";
import versions from "./lib-versions.ts";
import { formatDaggerError } from "./lib-errors.ts";
import {
  runValidationPhase,
  runPublishPhase,
  checkForFailures,
} from "./homelab-ci-steps.ts";

export type StepStatus = "passed" | "failed" | "skipped";
export type StepResult = {
  status: StepStatus;
  message: string;
};

export type HelmBuildResult = StepResult & {
  dist?: Directory;
};

export type HomelabSecrets = {
  argocdToken: Secret;
  ghcrUsername: string;
  ghcrPassword: Secret;
  chartVersion: string;
  chartRepo?: string;
  chartMuseumUsername: string;
  chartMuseumPassword: Secret;
  cloudflareApiToken: Secret;
  cloudflareAccountId: Secret;
  awsAccessKeyId: Secret;
  awsSecretAccessKey: Secret;
  hassBaseUrl?: Secret;
  hassToken?: Secret;
  tofuGithubToken?: Secret;
  appVersions?: Record<string, string>;
};

/**
 * Extract the homelab subdirectory from the monorepo root source.
 */
function getHomelabSource(monoRepoSource: Directory): Directory {
  return monoRepoSource.directory("packages/homelab");
}

/**
 * Update a single image version in versions.ts using sed.
 * Accepts homelab source directory (not monorepo root).
 */
function homelabUpdateVersion(
  source: Directory,
  imageKey: string,
  version: string,
): Directory {
  const escapedKey = imageKey.replaceAll("/", String.raw`\/`);
  return dag
    .container()
    .from(`alpine:${versions.alpine}`)
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec([
      "sed",
      "-i",
      `s/"${escapedKey}": "[^"]*"/"${escapedKey}": "${version}"/`,
      "src/cdk8s/src/versions.ts",
    ])
    .directory("/workspace");
}

/**
 * Update image versions for prod deployment.
 */
function updateVersionsForProd(
  source: Directory,
  chartVersion: string,
  appVersions?: Record<string, string>,
): Directory {
  let updatedSource = source;
  for (const key of [
    "shepherdjerred/homelab",
    "shepherdjerred/dependency-summary",
    "shepherdjerred/dns-audit",
    "shepherdjerred/caddy-s3proxy",
  ]) {
    updatedSource = homelabUpdateVersion(updatedSource, key, chartVersion);
  }
  if (appVersions) {
    for (const [key, ver] of Object.entries(appVersions)) {
      updatedSource = homelabUpdateVersion(updatedSource, key, ver);
    }
  }
  return updatedSource;
}

/**
 * Lightweight validation: runs parallel lint/typecheck for HA + CDK8s.
 * @param monoRepoSource The monorepo root source directory
 */
export async function checkHomelab(
  monoRepoSource: Directory,
  hassBaseUrl?: Secret,
  hassToken?: Secret,
): Promise<string> {
  const source = getHomelabSource(monoRepoSource);

  // Prepare containers with eslint-config mounted for lint operations
  const cdk8sContainer = withEslintConfig(
    prepareCdk8sContainer(source),
    monoRepoSource,
    "/workspace/src/cdk8s",
  );
  const haContainer = withEslintConfig(
    await prepareHaContainer(source, hassBaseUrl, hassToken),
    monoRepoSource,
    "/workspace/src/ha",
  );

  const results = await Promise.allSettled([
    typeCheckHaWithContainer(haContainer),
    lintHaWithContainer(haContainer),
    typeCheckCdk8sWithContainer(cdk8sContainer),
    lintCdk8sWithContainer(cdk8sContainer),
    testCdk8sWithContainer(cdk8sContainer),
  ]);
  const names = [
    "HA TypeCheck",
    "HA Lint",
    "CDK8s TypeCheck",
    "CDK8s Lint",
    "CDK8s Test",
  ];
  const summary = results
    .map((result, index) => {
      const name = names[index] ?? "Unknown";
      if (result.status === "fulfilled") {
        return `${name}: PASSED`;
      }
      const errorDetails = formatDaggerError(result.reason);
      return `${name}: FAILED\n${errorDetails}`;
    })
    .join("\n\n");
  return `Pipeline Results:\n${summary}`;
}

/**
 * Full CI pipeline: all checks + image builds + helm + argocd + release-please.
 * @param monoRepoSource The monorepo root source directory
 */
export async function ciHomelab(
  monoRepoSource: Directory,
  env: Stage,
  secrets: HomelabSecrets,
  versionOnly = false,
): Promise<string> {
  const source = getHomelabSource(monoRepoSource);

  // Update image versions in versions.ts if prod
  const updatedSource = env === Stage.Prod
    ? updateVersionsForProd(source, secrets.chartVersion, secrets.appVersions)
    : source;

  // Run validation steps in parallel
  const validation = await runValidationPhase(updatedSource, secrets, versionOnly, monoRepoSource);

  // Run publish steps (prod only)
  const publish = await runPublishPhase(env, updatedSource, secrets, validation.helmBuildResult);

  // Check for failures and return summary
  return checkForFailures(env, validation, publish);
}

/**
 * Build all Helm charts.
 * @param monoRepoSource The monorepo root source directory
 */
export function homelabHelmBuild(
  monoRepoSource: Directory,
  version: string,
): Directory {
  const homelabSource = getHomelabSource(monoRepoSource);
  return buildAllCharts(homelabSource, `1.0.0-${version}`);
}

/**
 * Test Helm chart structure, linting, and template rendering.
 * @param monoRepoSource The monorepo root source directory
 */
export async function homelabTestHelm(
  monoRepoSource: Directory,
): Promise<string> {
  const homelabSource = getHomelabSource(monoRepoSource);
  const testVersion = "0.1.0-test";
  const helmDist = buildAllCharts(homelabSource, testVersion);
  const helmBinary = dag
    .container()
    .from(`alpine/helm:${versions["alpine/helm"]}`)
    .file("/usr/bin/helm");

  const container = getMiseRuntimeContainer()
    .withMountedDirectory("/workspace", helmDist)
    .withWorkdir("/workspace")
    .withFile(
      "/workspace/test-helm.ts",
      homelabSource.file("scripts/test-helm.ts"),
    )
    .withFile("/usr/local/bin/helm", helmBinary)
    .withExec(["chmod", "+x", "/usr/local/bin/helm"])
    .withExec(["helm", "version"]);

  return execOrThrow(container, ["bun", "run", "./test-helm.ts"]);
}

/**
 * Test Renovate regex patterns in versions.ts files.
 * @param monoRepoSource The monorepo root source directory
 */
export async function homelabTestRenovateRegex(
  monoRepoSource: Directory,
): Promise<string> {
  const homelabSource = getHomelabSource(monoRepoSource);
  const daggerModuleSource = dag.currentModule().source();
  const container = getMiseRuntimeContainer()
    .withWorkdir("/workspace")
    .withFile("package.json", homelabSource.file("package.json"))
    .withFile("bun.lock", homelabSource.file("bun.lock"))
    .withDirectory("patches", homelabSource.directory("patches"))
    .withDirectory("src/ha", homelabSource.directory("src/ha"), {
      exclude: ["node_modules"],
    })
    .withDirectory("src/cdk8s", homelabSource.directory("src/cdk8s"), {
      exclude: ["node_modules"],
    })
    .withDirectory(
      "src/helm-types",
      homelabSource.directory("src/helm-types"),
      { exclude: ["node_modules"] },
    )
    .withDirectory(
      "src/deps-email",
      homelabSource.directory("src/deps-email"),
      { exclude: ["node_modules"] },
    )
    .withMountedCache(
      "/root/.bun/install/cache",
      dag.cacheVolume("bun-cache-default"),
    )
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withFile("renovate.json", homelabSource.file("renovate.json"))
    .withFile(
      "src/cdk8s/src/versions.ts",
      homelabSource.file("src/cdk8s/src/versions.ts"),
    )
    .withFile(
      ".dagger/src/versions.ts",
      daggerModuleSource.file("src/homelab/versions.ts"),
    )
    .withFile(
      ".dagger/test/test-renovate-regex.ts",
      daggerModuleSource.file("test/homelab-test-renovate-regex.ts"),
    );

  return execOrThrow(container, [
    "bun",
    "run",
    ".dagger/test/test-renovate-regex.ts",
  ]);
}

/**
 * Trigger an ArgoCD sync.
 */
export async function homelabSync(argocdToken: Secret): Promise<string> {
  const result = await argocdSync(argocdToken);
  return `ArgoCD Sync: ${result.status.toUpperCase()}\n${result.message}`;
}
