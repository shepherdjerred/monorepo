import type { FullDependencyDiff, ChartUpdate, ResolvedChart } from "./types.js";
import { extractAllImages, diffImages } from "./image-extractor.js";
import { fetchChartMetadata } from "./chart-fetcher.js";
import { resolveRepositoryUrl } from "./types.js";

/**
 * Compare two versions of a Helm chart and return all dependency changes
 *
 * This includes:
 * - Sub-chart version changes
 * - Container image version changes
 * - AppVersion changes
 */
export async function compareChartVersions(
  chartName: string,
  registryUrl: string,
  oldVersion: string,
  newVersion: string,
): Promise<FullDependencyDiff> {
  console.log(`Comparing ${chartName} ${oldVersion} -> ${newVersion}`);

  // Fetch chart metadata for both versions
  const [oldMeta, newMeta] = await Promise.all([
    fetchChartMetadata(chartName, registryUrl, oldVersion),
    fetchChartMetadata(chartName, registryUrl, newVersion),
  ]);

  // Extract all images from both versions
  const [oldImages, newImages] = await Promise.all([
    extractAllImages(chartName, registryUrl, oldVersion),
    extractAllImages(chartName, registryUrl, newVersion),
  ]);

  // Diff images
  const imageDiff = diffImages(oldImages, newImages);

  // Diff sub-charts
  const chartDiff = diffSubCharts(
    oldMeta.chartYaml.dependencies ?? [],
    oldMeta.chartLock,
    newMeta.chartYaml.dependencies ?? [],
    newMeta.chartLock,
    chartName,
  );

  // AppVersion changes
  type AppVersionChange = {
    chartName: string;
    oldAppVersion: string;
    newAppVersion: string;
  };
  const appVersionChanges: AppVersionChange[] = [];

  if (
    oldMeta.chartYaml.appVersion &&
    newMeta.chartYaml.appVersion &&
    oldMeta.chartYaml.appVersion !== newMeta.chartYaml.appVersion
  ) {
    appVersionChanges.push({
      chartName: chartName,
      oldAppVersion: oldMeta.chartYaml.appVersion,
      newAppVersion: newMeta.chartYaml.appVersion,
    });
  }

  return {
    charts: chartDiff,
    images: {
      added: imageDiff.added,
      removed: imageDiff.removed,
      updated: imageDiff.updated.map((u) => ({
        ...u,
        parentChart: chartName,
      })),
    },
    appVersions: {
      updated: appVersionChanges,
    },
  };
}

/**
 * Diff sub-chart dependencies between two versions
 */
type ChartDep = { name: string; version: string; repository?: string };
type LockDep = { name: string; version: string; repository: string };
type ChartLockData = { dependencies?: LockDep[] } | null;

function diffSubCharts(
  oldDeps: ChartDep[],
  oldLock: ChartLockData,
  newDeps: ChartDep[],
  newLock: ChartLockData,
  parentChart: string,
): {
  added: ResolvedChart[];
  removed: ResolvedChart[];
  updated: ChartUpdate[];
} {
  const added: ResolvedChart[] = [];
  const removed: ResolvedChart[] = [];
  const updated: ChartUpdate[] = [];

  // Build maps of old and new dependencies (use Chart.lock for pinned versions if available)
  const oldMap = new Map<string, { version: string; repository: string }>();
  const newMap = new Map<string, { version: string; repository: string }>();

  for (const dep of oldDeps) {
    const pinnedVersion = oldLock?.dependencies?.find((d) => d.name === dep.name)?.version;
    const repo = resolveRepositoryUrl(dep.repository) ?? "";
    oldMap.set(dep.name, {
      version: pinnedVersion ?? dep.version,
      repository: repo,
    });
  }

  for (const dep of newDeps) {
    const pinnedVersion = newLock?.dependencies?.find((d) => d.name === dep.name)?.version;
    const repo = resolveRepositoryUrl(dep.repository) ?? "";
    newMap.set(dep.name, {
      version: pinnedVersion ?? dep.version,
      repository: repo,
    });
  }

  // Find added and updated
  for (const [name, newInfo] of newMap) {
    const oldInfo = oldMap.get(name);

    if (!oldInfo) {
      // Added
      added.push({
        name,
        version: newInfo.version,
        repository: newInfo.repository,
        dependencies: [],
        images: [],
        depth: 1,
        parent: parentChart,
      });
    } else if (oldInfo.version !== newInfo.version) {
      // Updated
      updated.push({
        name,
        oldVersion: oldInfo.version,
        newVersion: newInfo.version,
        repository: newInfo.repository,
        depth: 1,
      });
    }
  }

  // Find removed
  for (const [name, oldInfo] of oldMap) {
    if (!newMap.has(name)) {
      removed.push({
        name,
        version: oldInfo.version,
        repository: oldInfo.repository,
        dependencies: [],
        images: [],
        depth: 1,
        parent: parentChart,
      });
    }
  }

  return { added, removed, updated };
}

/**
 * Get a flat list of all dependency changes including transitive changes
 *
 * This recursively resolves sub-chart changes
 */
export async function getFullDependencyChanges(
  chartName: string,
  registryUrl: string,
  oldVersion: string,
  newVersion: string,
  maxDepth = 3,
): Promise<FullDependencyDiff> {
  const visited = new Set<string>();

  return await getChangesRecursive(chartName, registryUrl, oldVersion, newVersion, 0, maxDepth, visited);
}

async function getChangesRecursive(
  chartName: string,
  registryUrl: string,
  oldVersion: string,
  newVersion: string,
  depth: number,
  maxDepth: number,
  visited: Set<string>,
): Promise<FullDependencyDiff> {
  const key = `${registryUrl}/${chartName}`;

  if (visited.has(key) || depth > maxDepth) {
    return emptyDiff();
  }

  visited.add(key);

  try {
    const diff = await compareChartVersions(chartName, registryUrl, oldVersion, newVersion);

    // Recursively get changes for updated sub-charts
    for (const update of diff.charts.updated) {
      if (update.repository) {
        try {
          const subDiff = await getChangesRecursive(
            update.name,
            update.repository,
            update.oldVersion,
            update.newVersion,
            depth + 1,
            maxDepth,
            visited,
          );

          // Merge sub-chart diff into main diff
          mergeDiffs(diff, subDiff, depth + 1);
        } catch (error) {
          console.warn(`Failed to get transitive deps for ${update.name}: ${String(error)}`);
        }
      }
    }

    return diff;
  } catch (error) {
    console.warn(`Failed to compare ${chartName}: ${String(error)}`);
    return emptyDiff();
  }
}

function emptyDiff(): FullDependencyDiff {
  return {
    charts: { added: [], removed: [], updated: [] },
    images: { added: [], removed: [], updated: [] },
    appVersions: { updated: [] },
  };
}

function mergeDiffs(target: FullDependencyDiff, source: FullDependencyDiff, depth: number): void {
  // Merge charts
  target.charts.added.push(...source.charts.added.map((c) => ({ ...c, depth })));
  target.charts.removed.push(...source.charts.removed.map((c) => ({ ...c, depth })));
  target.charts.updated.push(...source.charts.updated.map((c) => ({ ...c, depth })));

  // Merge images (deduplicate by repository)
  const existingImages = new Set(target.images.updated.map((i) => i.repository));

  for (const img of source.images.updated) {
    if (!existingImages.has(img.repository)) {
      target.images.updated.push(img);
      existingImages.add(img.repository);
    }
  }

  // Merge appVersions
  target.appVersions.updated.push(...source.appVersions.updated);
}

/**
 * Format the dependency diff for display
 */
export function formatDependencyDiff(diff: FullDependencyDiff): string {
  const lines: string[] = [];

  if (diff.charts.updated.length > 0) {
    lines.push("### Sub-chart Updates");
    for (const chart of diff.charts.updated) {
      const indent = "  ".repeat(chart.depth);
      lines.push(`${indent}- ${chart.name}: ${chart.oldVersion} → ${chart.newVersion}`);
    }
    lines.push("");
  }

  if (diff.charts.added.length > 0) {
    lines.push("### New Sub-charts");
    for (const chart of diff.charts.added) {
      lines.push(`- ${chart.name}: ${chart.version}`);
    }
    lines.push("");
  }

  if (diff.charts.removed.length > 0) {
    lines.push("### Removed Sub-charts");
    for (const chart of diff.charts.removed) {
      lines.push(`- ${chart.name}: ${chart.version}`);
    }
    lines.push("");
  }

  if (diff.images.updated.length > 0) {
    lines.push("### Container Image Updates");
    for (const img of diff.images.updated) {
      const registry = img.registry ? `${img.registry}/` : "";
      lines.push(`- ${registry}${img.repository}: ${img.oldTag} → ${img.newTag}`);
    }
    lines.push("");
  }

  if (diff.appVersions.updated.length > 0) {
    lines.push("### AppVersion Updates");
    for (const app of diff.appVersions.updated) {
      lines.push(`- ${app.chartName}: ${app.oldAppVersion} → ${app.newAppVersion}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
