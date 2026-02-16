import { parse as yamlParse } from "yaml";
import type { ChartYaml, ChartLock } from "./types.js";
import { ChartYamlSchema, ChartLockSchema } from "./types.js";

/**
 * Cache for fetched chart metadata
 */
const chartCache = new Map<string, ChartYaml>();
const lockCache = new Map<string, ChartLock | null>();

/**
 * Fetch Chart.yaml for a Helm chart
 */
export async function fetchChartYaml(chartName: string, registryUrl: string, version: string): Promise<ChartYaml> {
  const cacheKey = `${registryUrl}/${chartName}@${version}`;

  const cached = chartCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const chartPath = await pullChart(chartName, registryUrl, version);
  const chartYaml = await readChartYaml(chartPath, chartName);

  chartCache.set(cacheKey, chartYaml);

  return chartYaml;
}

/**
 * Fetch Chart.lock for a Helm chart (may not exist)
 */
export async function fetchChartLock(
  chartName: string,
  registryUrl: string,
  version: string,
): Promise<ChartLock | null> {
  const cacheKey = `${registryUrl}/${chartName}@${version}`;

  if (lockCache.has(cacheKey)) {
    return lockCache.get(cacheKey) ?? null;
  }

  const chartPath = await pullChart(chartName, registryUrl, version);
  const chartLock = await readChartLock(chartPath, chartName);

  lockCache.set(cacheKey, chartLock);

  return chartLock;
}

/**
 * Fetch both Chart.yaml and Chart.lock
 */
export async function fetchChartMetadata(
  chartName: string,
  registryUrl: string,
  version: string,
): Promise<{ chartYaml: ChartYaml; chartLock: ChartLock | null }> {
  const chartPath = await pullChart(chartName, registryUrl, version);

  const [chartYaml, chartLock] = await Promise.all([
    readChartYaml(chartPath, chartName),
    readChartLock(chartPath, chartName),
  ]);

  // Cache results
  const cacheKey = `${registryUrl}/${chartName}@${version}`;
  chartCache.set(cacheKey, chartYaml);
  lockCache.set(cacheKey, chartLock);

  return { chartYaml, chartLock };
}

/**
 * Pull a Helm chart to a temporary directory
 */
async function pullChart(chartName: string, registryUrl: string, version: string): Promise<string> {
  const pwd = Bun.env["PWD"] ?? process.cwd();
  const tempDir = `${pwd}/temp/helm-deps-${chartName.replace(/[^a-zA-Z0-9]/g, "-")}-${version}`;
  const repoName = `temp-repo-${chartName.replace(/[^a-zA-Z0-9]/g, "-")}-${String(Date.now())}`;

  try {
    // Ensure temp directory exists
    await Bun.$`mkdir -p ${tempDir}`.quiet();

    // Check if already pulled
    const chartDir = `${tempDir}/${chartName}`;
    const chartYamlPath = `${chartDir}/Chart.yaml`;

    try {
      await Bun.file(chartYamlPath).text();
      // Already exists, return path
      return tempDir;
    } catch {
      // Chart not cached locally, need to pull from registry
      console.debug(`[chart-fetcher] Chart ${chartName}@${version} not cached, pulling from ${registryUrl}`);
    }

    // Add the helm repo
    const addProc = Bun.spawn(["helm", "repo", "add", repoName, registryUrl], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const addExitCode = await addProc.exited;
    if (addExitCode !== 0) {
      const stderr = await new Response(addProc.stderr).text();
      throw new Error(`helm repo add failed: ${stderr}`);
    }

    // Update repo
    const updateProc = Bun.spawn(["helm", "repo", "update", repoName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const updateExitCode = await updateProc.exited;
    if (updateExitCode !== 0) {
      const stderr = await new Response(updateProc.stderr).text();
      throw new Error(`helm repo update failed: ${stderr}`);
    }

    // Pull the chart
    const pullProc = Bun.spawn(
      ["helm", "pull", `${repoName}/${chartName}`, "--version", version, "--destination", tempDir, "--untar"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const exitCode = await pullProc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(pullProc.stderr).text();
      throw new Error(`helm pull failed: ${stderr}`);
    }

    return tempDir;
  } finally {
    // Clean up repo (but keep the pulled chart)
    const removeProc = Bun.spawn(["helm", "repo", "remove", repoName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await removeProc.exited;
  }
}

/**
 * Read and parse Chart.yaml
 */
async function readChartYaml(chartPath: string, chartName: string): Promise<ChartYaml> {
  const chartYamlPath = `${chartPath}/${chartName}/Chart.yaml`;

  try {
    const content = await Bun.file(chartYamlPath).text();
    const parsed: unknown = yamlParse(content);

    const result = ChartYamlSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`Invalid Chart.yaml for ${chartName}: ${result.error.message}`);
      // Return minimal valid structure
      return {
        apiVersion: "v2",
        name: chartName,
        version: "0.0.0",
      };
    }

    return result.data;
  } catch (error) {
    throw new Error(`Failed to read Chart.yaml for ${chartName}: ${String(error)}`);
  }
}

/**
 * Read and parse Chart.lock (may not exist)
 */
async function readChartLock(chartPath: string, chartName: string): Promise<ChartLock | null> {
  const chartLockPath = `${chartPath}/${chartName}/Chart.lock`;

  try {
    const content = await Bun.file(chartLockPath).text();
    const parsed: unknown = yamlParse(content);

    const result = ChartLockSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`Invalid Chart.lock for ${chartName}: ${result.error.message}`);
      return null;
    }

    return result.data;
  } catch (error) {
    // Chart.lock doesn't exist - that's fine, not all charts have lock files
    console.debug(`[chart-fetcher] No Chart.lock for ${chartName}: ${String(error)}`);
    return null;
  }
}

/**
 * Clear the chart cache (useful for testing)
 */
export function clearChartCache(): void {
  chartCache.clear();
  lockCache.clear();
}

/**
 * Get the pinned version for a dependency from Chart.lock
 */
export function getPinnedVersion(chartLock: ChartLock | null, depName: string): string | null {
  if (!chartLock?.dependencies) {
    return null;
  }

  const dep = chartLock.dependencies.find((d) => d.name === depName);
  return dep?.version ?? null;
}
