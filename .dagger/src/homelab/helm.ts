import { dag, Directory, Secret, Container } from "@dagger.io/dagger";
import { buildK8sManifests } from "./cdk8s";
import versions from "./versions";

/**
 * List of all Helm charts to build and publish.
 * Each chart name corresponds to a CDK8s chart that outputs {name}.k8s.yaml
 */
export const HELM_CHARTS = [
  "ddns",
  "apps",
  "scout-beta",
  "scout-prod",
  "starlight-karma-bot-beta",
  "starlight-karma-bot-prod",
  "redlib",
  "better-skill-capped-fetcher",
  // New namespace charts
  "plausible",
  "birmel",
  "cloudflare-tunnel",
  // Per-service namespace charts
  "media",
  "home",
  "postal",
  "syncthing",
  "golink",
  "freshrss",
  "pokemon",
  "gickup",
  "grafana-db",
  // MCP gateway for aggregating MCP servers
  "mcp-gateway",
  // OpenClaw AI agent
  "openclaw",
  // S3 static sites (consolidates sjer-red, webring, dpp-docs, scout-frontend, better-skill-capped)
  "s3-static-sites",
  // Kyverno policies (separate to ensure CRDs exist before policies)
  "kyverno-policies",
  // Bugsink error tracking (Sentry SDK compatible)
  "bugsink",
  // DNS audit for SPF/DMARC/DKIM/MX validation
  "dns-audit",
] as const;
export type HelmChartName = (typeof HELM_CHARTS)[number];

/**
 * Creates a container with a single Helm chart built and packaged.
 * @param chartDir The Helm chart source directory (containing Chart.yaml).
 * @param chartName The name of the chart (must match CDK8s output file name).
 * @param cdk8sManifests The directory containing all CDK8s manifest files.
 * @param repoRoot The repository root directory.
 * @param version The version to set in Chart.yaml and appVersion.
 * @returns Container with the chart built and packaged.
 */
function getHelmContainerForChart(
  chartDir: Directory,
  chartName: string,
  cdk8sManifests: Directory,
  repoRoot: Directory,
  version: string,
): Container {
  return (
    dag
      .container()
      .from(`alpine/helm:${versions["alpine/helm"]}`)
      // Cache Helm registry data and repositories
      .withMountedCache("/root/.cache/helm", dag.cacheVolume("helm-cache"))
      // Use withDirectory instead of withMountedDirectory to avoid path resolution
      // issues when composing directories with withFile later
      .withDirectory("/workspace", chartDir)
      .withWorkdir("/workspace")
      // Update Chart.yaml version and appVersion using shared script
      .withFile("/usr/local/bin/helm-set-version.sh", repoRoot.file("scripts/helm-set-version.sh"))
      .withExec(["chmod", "+x", "/usr/local/bin/helm-set-version.sh"])
      .withExec(["helm-set-version.sh", "Chart.yaml", version])
      // Create templates directory and copy only this chart's manifest
      .withExec(["mkdir", "-p", "templates"])
      .withFile(`templates/${chartName}.k8s.yaml`, cdk8sManifests.file(`${chartName}.k8s.yaml`))
      // Package the chart
      .withExec(["helm", "package", "."])
  );
}

/**
 * Build a single Helm chart from a chart directory.
 * @param chartDir The Helm chart source directory (containing Chart.yaml).
 * @param chartName The name of the chart (must match CDK8s output file name).
 * @param cdk8sManifests The directory containing all CDK8s manifest files.
 * @param repoRoot The repository root directory.
 * @param version The full semver version (e.g. "1.0.0-123").
 * @returns The packaged chart file (.tgz).
 */
export function buildChart(
  chartDir: Directory,
  chartName: string,
  cdk8sManifests: Directory,
  repoRoot: Directory,
  version: string,
): Directory {
  const container = getHelmContainerForChart(chartDir, chartName, cdk8sManifests, repoRoot, version);

  return container
    .withExec(["mkdir", "-p", "dist"])
    .withExec(["sh", "-c", `cp ${chartName}-*.tgz dist/`])
    .directory("/workspace/dist");
}

/**
 * Build all Helm charts defined in HELM_CHARTS.
 * @param repoRoot The repository root directory.
 * @param version The full semver version (e.g. "1.0.0-123").
 * @returns A directory containing all packaged charts.
 */
export function buildAllCharts(repoRoot: Directory, version: string): Directory {
  const cdk8sManifests = buildK8sManifests(repoRoot);
  let outputDir = dag.directory();

  for (const chartName of HELM_CHARTS) {
    // Use full path from repo root to avoid nested .directory() issues
    const chartDir = repoRoot.directory(`src/cdk8s/helm/${chartName}`);
    const chartDist = buildChart(chartDir, chartName, cdk8sManifests, repoRoot, version);
    outputDir = outputDir.withDirectory(chartName, chartDist);
  }

  return outputDir;
}

/**
 * Publish a single pre-built Helm chart to a ChartMuseum repo.
 * @param chartName The name of the chart.
 * @param chartDist The directory containing the packaged chart (.tgz file).
 * @param version The full semver version (e.g. "1.0.0-123").
 * @param repo The ChartMuseum repo URL.
 * @param chartMuseumUsername The ChartMuseum username.
 * @param chartMuseumPassword The ChartMuseum password (secret).
 * @returns The curl output from the publish step.
 */
export async function publishChart(
  chartName: string,
  chartDist: Directory,
  version: string,
  repo = "https://chartmuseum.tailnet-1a49.ts.net",
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
): Promise<string> {
  const chartFile = `${chartName}-${version}.tgz`;
  // Use file-based output capture to avoid Dagger SDK URLSearchParams.toJSON bug with Bun
  const container = await dag
    .container()
    .from(`alpine/helm:${versions["alpine/helm"]}`)
    .withMountedDirectory("/workspace", chartDist)
    .withWorkdir("/workspace")
    .withEnvVariable("CHARTMUSEUM_USERNAME", chartMuseumUsername)
    .withSecretVariable("CHARTMUSEUM_PASSWORD", chartMuseumPassword)
    .withExec([
      "sh",
      "-c",
      `curl -u $CHARTMUSEUM_USERNAME:$CHARTMUSEUM_PASSWORD --data-binary @${chartFile} ${repo}/api/charts > /tmp/result.txt 2>&1; echo $? > /tmp/exitcode.txt`,
    ])
    .sync();

  const [result, exitCodeStr] = await Promise.all([
    container.file("/tmp/result.txt").contents(),
    container.file("/tmp/exitcode.txt").contents(),
  ]);
  const exitCode = parseInt(exitCodeStr.trim(), 10);

  if (exitCode === 0) {
    return result.trim() || "Chart published successfully";
  }

  // Check for 409 Conflict (chart already exists)
  if (result.includes("409")) {
    return "409 Conflict: Chart already exists, treating as success.";
  }

  throw new Error(`Chart publish failed (exit code ${String(exitCode)}): ${result.trim()}`);
}

/**
 * Publish all Helm charts to ChartMuseum.
 * @param allChartsDist The directory containing all chart subdirectories (from buildAllCharts).
 * @param version The full semver version (e.g. "1.0.0-123").
 * @param repo The ChartMuseum repo URL.
 * @param chartMuseumUsername The ChartMuseum username.
 * @param chartMuseumPassword The ChartMuseum password (secret).
 * @returns Object mapping chart names to their publish results.
 */
export async function publishAllCharts(
  allChartsDist: Directory,
  version: string,
  repo = "https://chartmuseum.tailnet-1a49.ts.net",
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  for (const chartName of HELM_CHARTS) {
    const chartDist = allChartsDist.directory(chartName);
    results[chartName] = await publishChart(
      chartName,
      chartDist,
      version,
      repo,
      chartMuseumUsername,
      chartMuseumPassword,
    );
  }

  return results;
}
