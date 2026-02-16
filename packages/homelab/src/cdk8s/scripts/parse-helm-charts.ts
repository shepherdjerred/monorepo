/**
 * Parse Helm chart information from versions.ts for the cdk8s application.
 * This is specific to the cdk8s project structure and not part of the helm-types library.
 */

export type ChartInfo = {
  name: string;
  repoUrl: string;
  version: string;
  chartName: string; // The actual chart name (may differ from versions.ts key)
};

/**
 * Parse chart information from versions.ts comments and values
 */
export async function parseChartInfoFromVersions(versionsPath = "src/versions.ts"): Promise<ChartInfo[]> {
  const content = await Bun.file(versionsPath).text();
  const lines = content.split("\n");
  const charts: ChartInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    // Look for renovate comments that indicate Helm charts
    if (line?.includes("renovate: datasource=helm") && nextLine) {
      const repoUrlMatch = /registryUrl=([^\s]+)/.exec(line);
      const versionKeyMatch = /^\s*"?([^":]+)"?:/.exec(nextLine);

      if (repoUrlMatch && versionKeyMatch) {
        const repoUrl = repoUrlMatch[1];
        const versionKey = versionKeyMatch[1];

        if (!repoUrl || !versionKey) continue;

        // Extract version value
        const versionMatch = /:\s*"([^"]+)"/.exec(nextLine);
        if (versionMatch) {
          const version = versionMatch[1];
          if (!version) continue;

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
      }
    }
  }

  return charts;
}
