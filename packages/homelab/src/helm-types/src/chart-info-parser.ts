import type { ChartInfo } from "./types.ts";

/**
 * Parse chart information from versions.ts comments and values
 */
export async function parseChartInfoFromVersions(
  versionsPath = "src/versions.ts",
): Promise<ChartInfo[]> {
  const content = await Bun.file(versionsPath).text();
  const lines = content.split("\n");
  const charts: ChartInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    // Look for renovate comments that indicate Helm charts
    if (
      line == null ||
      !line.includes("renovate: datasource=helm") ||
      nextLine == null ||
      nextLine === ""
    ) {
      continue;
    }

    const repoUrlMatch = /registryUrl=(\S+)/.exec(line);
    const versionKeyMatch = /^\s*"?([^":\s]+)"?:/.exec(nextLine);
    if (!repoUrlMatch || !versionKeyMatch) {
      continue;
    }

    const repoUrl = repoUrlMatch[1];
    const versionKey = versionKeyMatch[1];
    if (
      repoUrl == null ||
      repoUrl === "" ||
      versionKey == null ||
      versionKey === ""
    ) {
      continue;
    }

    // Extract version value
    const versionMatch = /:\s*"([^"]+)"/.exec(nextLine);
    if (!versionMatch) {
      continue;
    }

    const version = versionMatch[1];
    if (version == null || version === "") {
      continue;
    }

    // Try to determine chart name from the version key or URL
    let chartName = versionKey;

    // Handle special cases like "argo-cd" vs "argocd"
    if (versionKey === "argo-cd") {
      chartName = "argo-cd";
    }

    charts.push({
      name: versionKey,
      repoUrl: repoUrl.replace(/\/$/, ""), // Remove trailing slash
      version,
      chartName,
    });
  }

  return charts;
}
