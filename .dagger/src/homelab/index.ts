import type { Directory, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { formatDaggerError, execOrThrow } from "./errors.js";
import {
  typeCheckHa,
  lintHa,
  prepareHaContainer,
  typeCheckHaWithContainer,
  lintHaWithContainer,
  buildHaWithContainer,
  buildAndPushHaImage,
} from "./ha.js";
import { getMiseRuntimeContainer } from "./base.js";
import {
  typeCheckCdk8s,
  lintCdk8s,
  testCdk8s,
  prepareCdk8sContainer,
  typeCheckCdk8sWithContainer,
  lintCdk8sWithContainer,
  buildK8sManifestsWithContainer,
  testCdk8sWithContainer,
  validateCaddyfileWithContainer,
} from "./cdk8s.js";
import { sync as argocdSync } from "./argocd.js";
import { buildAndPushDependencySummaryImage } from "./dependency-summary.js";
import { buildAndPushDnsAuditImage } from "./dns-audit.js";
import { buildAndPushCaddyS3ProxyImage } from "./caddy-s3proxy.js";
import { buildAllCharts, HELM_CHARTS, publishAllCharts } from "./helm.js";
import { Stage } from "./stage.js";
import versions from "./versions.js";
import { planAll } from "./tofu.js";

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
 * Lightweight validation: runs parallel lint/typecheck for HA + CDK8s.
 * @param monoRepoSource The monorepo root source directory
 */
export async function checkHomelab(
  monoRepoSource: Directory,
  hassBaseUrl?: Secret,
  hassToken?: Secret,
): Promise<string> {
  const source = getHomelabSource(monoRepoSource);
  const haTypeCheck = typeCheckHa(source, hassBaseUrl, hassToken);
  const haLint = lintHa(source, hassBaseUrl, hassToken);
  const cdk8sTypeCheck = typeCheckCdk8s(source);
  const cdk8sLint = lintCdk8s(source);
  const cdk8sTest = testCdk8s(source);
  const results = await Promise.allSettled([
    haTypeCheck,
    haLint,
    cdk8sTypeCheck,
    cdk8sLint,
    cdk8sTest,
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
  const {
    argocdToken,
    ghcrUsername,
    ghcrPassword,
    chartVersion,
    chartRepo = "https://chartmuseum.tailnet-1a49.ts.net",
    chartMuseumUsername,
    chartMuseumPassword,
    cloudflareApiToken,
    cloudflareAccountId,
    awsAccessKeyId,
    awsSecretAccessKey,
    hassBaseUrl,
    hassToken,
    tofuGithubToken,
  } = secrets;

  // Update image versions in versions.ts if prod
  let updatedSource = source;
  if (env === Stage.Prod) {
    // Infra images use chartVersion
    for (const key of [
      "shepherdjerred/homelab",
      "shepherdjerred/dependency-summary",
      "shepherdjerred/dns-audit",
      "shepherdjerred/caddy-s3proxy",
    ]) {
      updatedSource = homelabUpdateVersion(updatedSource, key, chartVersion);
    }
    // App images from upstream callers
    if (secrets.appVersions) {
      for (const [key, ver] of Object.entries(secrets.appVersions)) {
        updatedSource = homelabUpdateVersion(updatedSource, key, ver);
      }
    }
  }

  // Prepare shared containers once
  const haContainerPromise = versionOnly
    ? undefined
    : prepareHaContainer(updatedSource, hassBaseUrl, hassToken);
  const cdk8sContainer = prepareCdk8sContainer(updatedSource);
  const versionOnlySkip = (
    name: string,
  ): Promise<{ status: "skipped"; message: string }> =>
    Promise.resolve({
      status: "skipped" as const,
      message: `${name}: SKIPPED (version-only)`,
    });

  // Renovate regex test
  const renovateTestPromise = homelabTestRenovateRegex(updatedSource)
    .then((msg) => ({
      status: "passed" as const,
      message: `Renovate Test: PASSED\n${msg}`,
    }))
    .catch((e: unknown) => ({
      status: "failed" as const,
      message: `Renovate Test: FAILED\n${formatDaggerError(e)}`,
    }));

  // Helm test
  const helmTestPromise = versionOnly
    ? versionOnlySkip("Helm Test")
    : homelabTestHelm(updatedSource)
        .then((msg) => ({
          status: "passed" as const,
          message: `Helm Test: PASSED\n${msg}`,
        }))
        .catch((e: unknown) => ({
          status: "failed" as const,
          message: `Helm Test: FAILED\n${formatDaggerError(e)}`,
        }));

  // CDK8s test
  const cdk8sTestPromise = versionOnly
    ? versionOnlySkip("CDK8s Test")
    : testCdk8sWithContainer(cdk8sContainer)
        .then((msg) => ({
          status: "passed" as const,
          message: `CDK8s Test: PASSED\n${msg}`,
        }))
        .catch((e: unknown) => ({
          status: "failed" as const,
          message: `CDK8s Test: FAILED\n${formatDaggerError(e)}`,
        }));

  // Caddyfile validation
  const caddyfileValidatePromise = versionOnly
    ? versionOnlySkip("Caddyfile Validate")
    : validateCaddyfileWithContainer(cdk8sContainer)
        .then((msg) => ({
          status: "passed" as const,
          message: `Caddyfile Validate: PASSED\n${msg}`,
        }))
        .catch((e: unknown) => ({
          status: "failed" as const,
          message: `Caddyfile Validate: FAILED\n${formatDaggerError(e)}`,
        }));

  // CDK8s linting
  const cdk8sLintPromise = versionOnly
    ? versionOnlySkip("CDK8s Lint")
    : lintCdk8sWithContainer(cdk8sContainer)
        .then((msg) => ({
          status: "passed" as const,
          message: `CDK8s Lint: PASSED\n${msg}`,
        }))
        .catch((e: unknown) => ({
          status: "failed" as const,
          message: `CDK8s Lint: FAILED\n${formatDaggerError(e)}`,
        }));

  // HA linting
  const haLintPromise =
    versionOnly || !haContainerPromise
      ? versionOnlySkip("HA Lint")
      : haContainerPromise
          .then((container) => lintHaWithContainer(container))
          .then((msg) => ({
            status: "passed" as const,
            message: `HA Lint: PASSED\n${msg}`,
          }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `HA Lint: FAILED\n${formatDaggerError(e)}`,
          }));

  // CDK8s type checking
  const cdk8sTypeCheckPromise = typeCheckCdk8sWithContainer(cdk8sContainer)
    .then((msg) => ({
      status: "passed" as const,
      message: `CDK8s TypeCheck: PASSED\n${msg}`,
    }))
    .catch((e: unknown) => ({
      status: "failed" as const,
      message: `CDK8s TypeCheck: FAILED\n${formatDaggerError(e)}`,
    }));

  // HA type checking
  const haTypeCheckPromise =
    versionOnly || !haContainerPromise
      ? versionOnlySkip("HA TypeCheck")
      : haContainerPromise
          .then((container) => typeCheckHaWithContainer(container))
          .then((msg) => ({
            status: "passed" as const,
            message: `HA TypeCheck: PASSED\n${msg}`,
          }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `HA TypeCheck: FAILED\n${formatDaggerError(e)}`,
          }));

  // OpenTofu plan
  const tofuPlanPromise = planAll(
    updatedSource,
    cloudflareApiToken,
    cloudflareAccountId,
    awsAccessKeyId,
    awsSecretAccessKey,
    tofuGithubToken,
  )
    .then((msg) => ({
      status: "passed" as const,
      message: `Tofu Plan: PASSED\n${msg}`,
    }))
    .catch((e: unknown) => ({
      status: "failed" as const,
      message: `Tofu Plan: FAILED\n${formatDaggerError(e)}`,
    }));

  // CDK8s build
  const cdk8sBuildPromise = Promise.resolve(
    buildK8sManifestsWithContainer(cdk8sContainer),
  )
    .then(() => ({
      status: "passed" as const,
      message: "CDK8s Build: PASSED",
    }))
    .catch((e: unknown) => ({
      status: "failed" as const,
      message: `CDK8s Build: FAILED\n${formatDaggerError(e)}`,
    }));

  // HA build
  const haBuildPromise =
    versionOnly || !haContainerPromise
      ? versionOnlySkip("HA Build")
      : haContainerPromise
          .then((container) => buildHaWithContainer(container))
          .then(() => ({
            status: "passed" as const,
            message: "HA Build: PASSED",
          }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `HA Build: FAILED\n${formatDaggerError(e)}`,
          }));

  // Helm build
  const helmBuildPromise = Promise.resolve().then(() => {
    try {
      const dist = homelabHelmBuild(
        updatedSource,
        chartVersion || "dev-snapshot",
      );
      return {
        status: "passed" as const,
        message: "Helm Build: PASSED",
        dist,
      };
    } catch (e: unknown) {
      return {
        status: "failed" as const,
        message: `Helm Build: FAILED\n${formatDaggerError(e)}`,
        dist: undefined,
      };
    }
  });

  // Await all
  const [
    cdk8sBuildResult,
    haBuildResult,
    helmBuildResult,
    renovateTestResult,
    helmTestResult,
    cdk8sTestResult,
    caddyfileValidateResult,
    cdk8sLintResult,
    haLintResult,
    cdk8sTypeCheckResult,
    haTypeCheckResult,
    tofuPlanResult,
  ] = await Promise.all([
    cdk8sBuildPromise,
    haBuildPromise,
    helmBuildPromise,
    renovateTestPromise,
    helmTestPromise,
    cdk8sTestPromise,
    caddyfileValidatePromise,
    cdk8sLintPromise,
    haLintPromise,
    cdk8sTypeCheckPromise,
    haTypeCheckPromise,
    tofuPlanPromise,
  ]);

  // Publish phase (prod only)
  let haPublishResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod",
  };
  let depSummaryPublishResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod",
  };
  let dnsAuditPublishResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod",
  };
  let caddyS3ProxyPublishResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod",
  };
  let helmPublishResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod",
  };

  if (env === Stage.Prod) {
    const [
      haResults,
      depSummaryResults,
      dnsAuditResults,
      caddyS3ProxyResult,
      helmResult,
    ] = await Promise.all([
      Promise.all([
        buildAndPushHaImage(
          updatedSource,
          `ghcr.io/shepherdjerred/homelab:${chartVersion}`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
        buildAndPushHaImage(
          updatedSource,
          `ghcr.io/shepherdjerred/homelab:latest`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
      ]),
      Promise.all([
        buildAndPushDependencySummaryImage(
          updatedSource,
          `ghcr.io/shepherdjerred/dependency-summary:${chartVersion}`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
        buildAndPushDependencySummaryImage(
          updatedSource,
          `ghcr.io/shepherdjerred/dependency-summary:latest`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
      ]),
      Promise.all([
        buildAndPushDnsAuditImage(
          `ghcr.io/shepherdjerred/dns-audit:${chartVersion}`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
        buildAndPushDnsAuditImage(
          `ghcr.io/shepherdjerred/dns-audit:latest`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
      ]),
      Promise.all([
        buildAndPushCaddyS3ProxyImage(
          `ghcr.io/shepherdjerred/caddy-s3proxy:${chartVersion}`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
        buildAndPushCaddyS3ProxyImage(
          `ghcr.io/shepherdjerred/caddy-s3proxy:latest`,
          ghcrUsername,
          ghcrPassword,
          false,
        ),
      ]).then(([versioned, latest]) => ({
        status:
          versioned.status === "passed" && latest.status === "passed"
            ? ("passed" as const)
            : ("failed" as const),
        message: `Versioned tag: ${versioned.message}\nLatest tag: ${latest.message}`,
      })),
      helmBuildResult.dist
        ? homelabHelmPublishBuilt(
            helmBuildResult.dist,
            `1.0.0-${chartVersion}`,
            chartRepo,
            chartMuseumUsername,
            chartMuseumPassword,
            env,
          )
        : Promise.resolve({
            status: "skipped" as const,
            message: "[SKIPPED] No dist available",
          }),
    ]);

    haPublishResult = {
      status:
        haResults[0].status === "passed" && haResults[1].status === "passed"
          ? "passed"
          : "failed",
      message: `Versioned tag: ${haResults[0].message}\nLatest tag: ${haResults[1].message}`,
    };
    depSummaryPublishResult = {
      status:
        depSummaryResults[0].status === "passed" &&
        depSummaryResults[1].status === "passed"
          ? "passed"
          : "failed",
      message: `Versioned tag: ${depSummaryResults[0].message}\nLatest tag: ${depSummaryResults[1].message}`,
    };
    dnsAuditPublishResult = {
      status:
        dnsAuditResults[0].status === "passed" &&
        dnsAuditResults[1].status === "passed"
          ? "passed"
          : "failed",
      message: `Versioned tag: ${dnsAuditResults[0].message}\nLatest tag: ${dnsAuditResults[1].message}`,
    };
    caddyS3ProxyPublishResult = caddyS3ProxyResult;
    helmPublishResult = helmResult;
  }

  // Sync
  let syncResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod or chart publish failed",
  };
  if (env === Stage.Prod && helmPublishResult.status === "passed") {
    syncResult = await argocdSync(argocdToken);
  }

  // Build summary
  const summary = [
    renovateTestResult.message,
    helmTestResult.message,
    cdk8sTestResult.message,
    caddyfileValidateResult.message,
    cdk8sLintResult.message,
    haLintResult.message,
    cdk8sTypeCheckResult.message,
    haTypeCheckResult.message,
    `Sync result:\n${syncResult.message}`,
    cdk8sBuildResult.message,
    haBuildResult.message,
    helmBuildResult.message,
    `HA Image Publish result:\n${haPublishResult.message}`,
    `Dependency Summary Image Publish result:\n${depSummaryPublishResult.message}`,
    `Dns Audit Image Publish result:\n${dnsAuditPublishResult.message}`,
    `Caddy S3Proxy Image Publish result:\n${caddyS3ProxyPublishResult.message}`,
    `Helm Chart Publish result:\n${helmPublishResult.message}`,
    tofuPlanResult.message,
  ].join("\n\n");

  if (
    renovateTestResult.status === "failed" ||
    helmTestResult.status === "failed" ||
    cdk8sTestResult.status === "failed" ||
    caddyfileValidateResult.status === "failed" ||
    cdk8sLintResult.status === "failed" ||
    haLintResult.status === "failed" ||
    cdk8sTypeCheckResult.status === "failed" ||
    haTypeCheckResult.status === "failed" ||
    syncResult.status === "failed" ||
    cdk8sBuildResult.status === "failed" ||
    haBuildResult.status === "failed" ||
    helmBuildResult.status === "failed" ||
    (env === Stage.Prod &&
      (haPublishResult.status === "failed" ||
        depSummaryPublishResult.status === "failed" ||
        dnsAuditPublishResult.status === "failed" ||
        caddyS3ProxyPublishResult.status === "failed" ||
        helmPublishResult.status === "failed"))
  ) {
    throw new Error(summary);
  }
  return summary;
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
  const escapedKey = imageKey.replaceAll("/", "\\/");
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
  // The test file and dagger versions.ts are inside the Dagger module (excluded from source),
  // so we access them via dag.currentModule().source()
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
    // Map dagger module files to paths the test expects
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

/**
 * Publish a pre-built Helm chart to ChartMuseum.
 */
async function homelabHelmPublishBuilt(
  builtDist: Directory,
  version: string,
  repo: string,
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
  env: Stage,
): Promise<StepResult> {
  if (env !== Stage.Prod) {
    return { status: "skipped", message: "[SKIPPED] Not prod" };
  }
  try {
    const results: string[] = [];
    for (const chartName of HELM_CHARTS) {
      const chartFile = `${chartName}-${version}.tgz`;
      const container = dag
        .container()
        .from(`alpine/helm:${versions["alpine/helm"]}`)
        .withMountedDirectory("/workspace", builtDist.directory(chartName))
        .withWorkdir("/workspace")
        .withEnvVariable("CHARTMUSEUM_USERNAME", chartMuseumUsername)
        .withSecretVariable("CHARTMUSEUM_PASSWORD", chartMuseumPassword)
        .withExec([
          "sh",
          "-c",
          `curl -s -w '\\n%{http_code}' -u $CHARTMUSEUM_USERNAME:$CHARTMUSEUM_PASSWORD --data-binary @${chartFile} ${repo}/api/charts > /tmp/result.txt 2>&1`,
        ]);

      const result = await container.file("/tmp/result.txt").contents();
      const lines = result.trim().split("\n");
      const httpCode = lines.pop() ?? "";
      const body = lines.join("\n");

      if (httpCode === "201" || httpCode === "200") {
        results.push(`${chartName}: published successfully`);
      } else if (httpCode === "409") {
        results.push(`${chartName}: already exists (409)`);
      } else {
        return {
          status: "failed",
          message: `Helm Chart Publish: FAILED for ${chartName}\nHTTP ${httpCode}: ${body}`,
        };
      }
    }
    return { status: "passed", message: results.join("\n") };
  } catch (err: unknown) {
    const errorMessage = formatDaggerError(err);
    return {
      status: "failed",
      message: `Helm Chart Publish: FAILED\n${errorMessage}`,
    };
  }
}

export { Stage } from "./stage.js";
