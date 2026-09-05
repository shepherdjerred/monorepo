import { readFile } from "node:fs/promises";
import type { ChartInfo } from "./types.js";

/**
 * Parse chart information from versions.ts comments and values
 */
export async function parseChartInfoFromVersions(
  versionsPath = "src/versions.ts",
): Promise<ChartInfo[]> {
  const content = await readFile(versionsPath, "utf8");
  const lines = content.split("\n");
  const charts: ChartInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    // Look for renovate comments that indicate Helm charts
    if (
      line == null ||
      nextLine == null ||
      nextLine === "" ||
      !line.includes("renovate: datasource=helm")
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
