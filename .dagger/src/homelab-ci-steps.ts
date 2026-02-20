import type { Container, Directory, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { formatDaggerError } from "./lib-errors.ts";
import { withEslintConfig } from "./homelab-base.ts";
import {
  prepareHaContainer,
  typeCheckHaWithContainer,
  lintHaWithContainer,
  buildHaWithContainer,
  buildAndPushHaImage,
} from "./homelab-ha.ts";
import {
  prepareCdk8sContainer,
  typeCheckCdk8sWithContainer,
  lintCdk8sWithContainer,
  buildK8sManifestsWithContainer,
  testCdk8sWithContainer,
  validateCaddyfileWithContainer,
} from "./homelab-cdk8s.ts";
import { sync as argocdSync } from "./homelab-argocd.ts";
import { buildAndPushDependencySummaryImage } from "./homelab-dependency-summary.ts";
import { buildAndPushDnsAuditImage } from "./homelab-dns-audit.ts";
import { buildAndPushCaddyS3ProxyImage } from "./homelab-caddy-s3proxy.ts";
import { HELM_CHARTS } from "./homelab-helm.ts";
import { Stage } from "./lib-types.ts";
import type { StepResult, HelmBuildResult, HomelabSecrets } from "./homelab-index.ts";
import { homelabTestHelm, homelabTestRenovateRegex, homelabHelmBuild } from "./homelab-index.ts";
import { planAll } from "./homelab-tofu.ts";
import versions from "./lib-versions.ts";

/** Run an async step and capture the result as a StepResult. */
async function runStep(name: string, fn: () => Promise<string>): Promise<StepResult> {
  try {
    const msg = await fn();
    return { status: "passed", message: `${name}: PASSED${msg === "" ? "" : `\n${msg}`}` };
  } catch (error: unknown) {
    return { status: "failed", message: `${name}: FAILED\n${formatDaggerError(error)}` };
  }
}

/** Run a step or skip it if versionOnly is true. */
function runStepOrSkip(
  name: string, versionOnly: boolean, fn: () => Promise<string>,
): Promise<StepResult> {
  if (versionOnly) {
    return Promise.resolve({ status: "skipped" as const, message: `${name}: SKIPPED (version-only)` });
  }
  return runStep(name, fn);
}

/** Run an async step that depends on a container promise. */
async function runContainerStep(
  name: string, containerPromise: Promise<Container> | undefined,
  versionOnly: boolean, fn: (container: Container) => Promise<string>,
): Promise<StepResult> {
  if (versionOnly || containerPromise === undefined) {
    return { status: "skipped", message: `${name}: SKIPPED (version-only)` };
  }
  try {
    const container = await containerPromise;
    const msg = await fn(container);
    return { status: "passed", message: `${name}: PASSED${msg === "" ? "" : `\n${msg}`}` };
  } catch (error: unknown) {
    return { status: "failed", message: `${name}: FAILED\n${formatDaggerError(error)}` };
  }
}

type ValidationResults = {
  renovateTestResult: StepResult;
  helmTestResult: StepResult;
  cdk8sTestResult: StepResult;
  caddyfileValidateResult: StepResult;
  cdk8sLintResult: StepResult;
  haLintResult: StepResult;
  cdk8sTypeCheckResult: StepResult;
  haTypeCheckResult: StepResult;
  tofuPlanResult: StepResult;
  cdk8sBuildResult: StepResult;
  haBuildResult: StepResult;
  helmBuildResult: HelmBuildResult;
};

/**
 * Run all validation steps in parallel.
 */
export async function runValidationPhase(
  updatedSource: Directory,
  secrets: HomelabSecrets,
  versionOnly: boolean,
  monoRepoSource?: Directory,
): Promise<ValidationResults> {
  const {
    cloudflareApiToken,
    cloudflareAccountId,
    awsAccessKeyId,
    awsSecretAccessKey,
    hassBaseUrl,
    hassToken,
    tofuGithubToken,
    chartVersion,
  } = secrets;

  const haContainerPromise = versionOnly
    ? undefined
    : (async () => {
        const container = await prepareHaContainer(
          updatedSource,
          hassBaseUrl,
          hassToken,
        );
        return monoRepoSource
          ? withEslintConfig(container, monoRepoSource, "/workspace/src/ha")
          : container;
      })();
  const baseCdk8sContainer = prepareCdk8sContainer(updatedSource);
  const cdk8sContainer = monoRepoSource
    ? withEslintConfig(
        baseCdk8sContainer,
        monoRepoSource,
        "/workspace/src/cdk8s",
      )
    : baseCdk8sContainer;

  const [
    renovateTestResult,
    helmTestResult,
    cdk8sTestResult,
    caddyfileValidateResult,
    cdk8sLintResult,
    haLintResult,
    cdk8sTypeCheckResult,
    haTypeCheckResult,
    tofuPlanResult,
    cdk8sBuildResult,
    haBuildResult,
    helmBuildResult,
  ] = await Promise.all([
    runStep("Renovate Test", () => homelabTestRenovateRegex(updatedSource)),
    runStepOrSkip("Helm Test", versionOnly, () => homelabTestHelm(updatedSource)),
    runStepOrSkip("CDK8s Test", versionOnly, () => testCdk8sWithContainer(cdk8sContainer)),
    runStepOrSkip("Caddyfile Validate", versionOnly, () => validateCaddyfileWithContainer(cdk8sContainer)),
    runStepOrSkip("CDK8s Lint", versionOnly, () => lintCdk8sWithContainer(cdk8sContainer)),
    runContainerStep("HA Lint", haContainerPromise, versionOnly, (c) =>
      lintHaWithContainer(c),
    ),
    runStep("CDK8s TypeCheck", () =>
      typeCheckCdk8sWithContainer(cdk8sContainer),
    ),
    runContainerStep("HA TypeCheck", haContainerPromise, versionOnly, (c) =>
      typeCheckHaWithContainer(c),
    ),
    runStep("Tofu Plan", () =>
      planAll({
        source: updatedSource,
        cloudflareApiToken,
        cloudflareAccountId,
        awsAccessKeyId,
        awsSecretAccessKey,
        githubToken: tofuGithubToken,
      }),
    ),
    runStep("CDK8s Build", () => {
      buildK8sManifestsWithContainer(cdk8sContainer);
      return Promise.resolve("");
    }),
    runContainerStep("HA Build", haContainerPromise, versionOnly, (c) => {
      buildHaWithContainer(c);
      return Promise.resolve("");
    }),
    ((): Promise<HelmBuildResult> => {
      try {
        const dist = homelabHelmBuild(
          updatedSource,
          chartVersion || "dev-snapshot",
        );
        return Promise.resolve({
          status: "passed",
          message: "Helm Build: PASSED",
          dist,
        });
      } catch (error: unknown) {
        return Promise.resolve({
          status: "failed",
          message: `Helm Build: FAILED\n${formatDaggerError(error)}`,
        });
      }
    })(),
  ]);

  return {
    renovateTestResult,
    helmTestResult,
    cdk8sTestResult,
    caddyfileValidateResult,
    cdk8sLintResult,
    haLintResult,
    cdk8sTypeCheckResult,
    haTypeCheckResult,
    tofuPlanResult,
    cdk8sBuildResult,
    haBuildResult,
    helmBuildResult,
  };
}

/** Combine two publish results (versioned + latest tags) into one. */
function combinePublishResults(results: [StepResult, StepResult]): StepResult {
  const status = results[0].status === "passed" && results[1].status === "passed" ? "passed" : "failed";
  return { status, message: `Versioned tag: ${results[0].message}\nLatest tag: ${results[1].message}` };
}

type PublishResults = {
  haPublishResult: StepResult;
  depSummaryPublishResult: StepResult;
  dnsAuditPublishResult: StepResult;
  caddyS3ProxyPublishResult: StepResult;
  helmPublishResult: StepResult;
  syncResult: StepResult;
};

type HelmPublishOptions = {
  builtDist: Directory;
  version: string;
  repo: string;
  chartMuseumUsername: string;
  chartMuseumPassword: Secret;
};

/**
 * Publish a pre-built Helm chart to ChartMuseum.
 */
export async function homelabHelmPublishBuilt(
  options: HelmPublishOptions,
): Promise<StepResult> {
  const { builtDist, version, repo, chartMuseumUsername, chartMuseumPassword } =
    options;
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
          String.raw`curl -s -w '\n%{http_code}' -u $CHARTMUSEUM_USERNAME:$CHARTMUSEUM_PASSWORD --data-binary @${chartFile} ${repo}/api/charts > /tmp/result.txt 2>&1`,
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
  } catch (error: unknown) {
    const errorMessage = formatDaggerError(error);
    return {
      status: "failed",
      message: `Helm Chart Publish: FAILED\n${errorMessage}`,
    };
  }
}

const SKIP_RESULT: StepResult = {
  status: "skipped",
  message: "[SKIPPED] Not prod",
};

/**
 * Run the publish phase (prod only).
 */
export async function runPublishPhase(
  env: Stage,
  updatedSource: Directory,
  secrets: HomelabSecrets,
  helmBuildResult: HelmBuildResult,
): Promise<PublishResults> {
  if (env !== Stage.Prod) {
    return {
      haPublishResult: SKIP_RESULT,
      depSummaryPublishResult: SKIP_RESULT,
      dnsAuditPublishResult: SKIP_RESULT,
      caddyS3ProxyPublishResult: SKIP_RESULT,
      helmPublishResult: SKIP_RESULT,
      syncResult: {
        status: "skipped",
        message: "[SKIPPED] Not prod or chart publish failed",
      },
    };
  }

  const {
    argocdToken,
    ghcrUsername,
    ghcrPassword,
    chartVersion,
    chartRepo = "https://chartmuseum.tailnet-1a49.ts.net",
    chartMuseumUsername,
    chartMuseumPassword,
  } = secrets;

  const [
    haResults,
    depSummaryResults,
    dnsAuditResults,
    caddyS3ProxyResult,
    helmResult,
  ] = await Promise.all([
    Promise.all([
      buildAndPushHaImage({
        source: updatedSource,
        imageName: `ghcr.io/shepherdjerred/homelab:${chartVersion}`,
        ghcrUsername,
        ghcrPassword,
        dryRun: false,
      }),
      buildAndPushHaImage({
        source: updatedSource,
        imageName: `ghcr.io/shepherdjerred/homelab:latest`,
        ghcrUsername,
        ghcrPassword,
        dryRun: false,
      }),
    ]),
    Promise.all([
      buildAndPushDependencySummaryImage({
        source: updatedSource,
        imageName: `ghcr.io/shepherdjerred/dependency-summary:${chartVersion}`,
        ghcrUsername,
        ghcrPassword,
        dryRun: false,
      }),
      buildAndPushDependencySummaryImage({
        source: updatedSource,
        imageName: `ghcr.io/shepherdjerred/dependency-summary:latest`,
        ghcrUsername,
        ghcrPassword,
        dryRun: false,
      }),
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
    (async (): Promise<StepResult> => {
      const [versioned, latest] = await Promise.all([
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
      ]);
      return combinePublishResults([versioned, latest]);
    })(),
    helmBuildResult.dist
      ? homelabHelmPublishBuilt({
          builtDist: helmBuildResult.dist,
          version: `1.0.0-${chartVersion}`,
          repo: chartRepo,
          chartMuseumUsername,
          chartMuseumPassword,
        })
      : Promise.resolve({
          status: "skipped" as const,
          message: "[SKIPPED] No dist available",
        }),
  ]);

  const helmPublishResult = helmResult;

  let syncResult: StepResult = {
    status: "skipped",
    message: "[SKIPPED] Not prod or chart publish failed",
  };
  if (helmPublishResult.status === "passed") {
    syncResult = await argocdSync(argocdToken);
  }

  return {
    haPublishResult: combinePublishResults(haResults),
    depSummaryPublishResult: combinePublishResults(depSummaryResults),
    dnsAuditPublishResult: combinePublishResults(dnsAuditResults),
    caddyS3ProxyPublishResult: caddyS3ProxyResult,
    helmPublishResult,
    syncResult,
  };
}

/**
 * Check if any results indicate failure and throw if so.
 */
export function checkForFailures(
  env: Stage,
  validation: ValidationResults,
  publish: PublishResults,
): string {
  const summary = [
    validation.renovateTestResult.message,
    validation.helmTestResult.message,
    validation.cdk8sTestResult.message,
    validation.caddyfileValidateResult.message,
    validation.cdk8sLintResult.message,
    validation.haLintResult.message,
    validation.cdk8sTypeCheckResult.message,
    validation.haTypeCheckResult.message,
    `Sync result:\n${publish.syncResult.message}`,
    validation.cdk8sBuildResult.message,
    validation.haBuildResult.message,
    validation.helmBuildResult.message,
    `HA Image Publish result:\n${publish.haPublishResult.message}`,
    `Dependency Summary Image Publish result:\n${publish.depSummaryPublishResult.message}`,
    `Dns Audit Image Publish result:\n${publish.dnsAuditPublishResult.message}`,
    `Caddy S3Proxy Image Publish result:\n${publish.caddyS3ProxyPublishResult.message}`,
    `Helm Chart Publish result:\n${publish.helmPublishResult.message}`,
    validation.tofuPlanResult.message,
  ].join("\n\n");

  const validationFailed = [
    validation.renovateTestResult,
    validation.helmTestResult,
    validation.cdk8sTestResult,
    validation.caddyfileValidateResult,
    validation.cdk8sLintResult,
    validation.haLintResult,
    validation.cdk8sTypeCheckResult,
    validation.haTypeCheckResult,
    publish.syncResult,
    validation.cdk8sBuildResult,
    validation.haBuildResult,
    validation.helmBuildResult,
  ].some((r) => r.status === "failed");

  const publishFailed =
    env === Stage.Prod &&
    [
      publish.haPublishResult,
      publish.depSummaryPublishResult,
      publish.dnsAuditPublishResult,
      publish.caddyS3ProxyPublishResult,
      publish.helmPublishResult,
    ].some((r) => r.status === "failed");

  if (validationFailed || publishFailed) {
    throw new Error(summary);
  }
  return summary;
}
