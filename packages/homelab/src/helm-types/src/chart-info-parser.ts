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
      nextLine === "" ||
      line == null ||
      !line.includes("renovate: datasource=helm") ||
      nextLine == null
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
      repoUrl === "" ||
      versionKey === "" ||
      repoUrl == null ||
      versionKey == null
    ) {
      continue;
    }

    // Extract version value
    const versionMatch = /:\s*"([^"]+)"/.exec(nextLine);
    if (!versionMatch) {
      continue;
    }

    const version = versionMatch[1];
    if (version === "" || version == null) {
      continue;
    }

    charts.push({
      name: versionKey,
      repoUrl: repoUrl.replace(/\/$/, ""), // Remove trailing slash
      version,
      chartName: versionKey,
    });
  }

  return charts;
}
